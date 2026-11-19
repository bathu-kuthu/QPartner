const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'com.quickora.qpartner';
const PACKAGE_PATH = 'com/quickora/qpartner';

const DRIVER_OVERLAY_SERVICE_KT = `package ${PACKAGE_NAME}

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.*
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class DriverOverlayService : Service() {

    companion object {
        const val PREFS_NAME = "qpartner_driver_prefs"
        const val ACTION_START = "com.quickora.qpartner.ACTION_START_OVERLAY"
        const val ACTION_STOP = "com.quickora.qpartner.ACTION_STOP_OVERLAY"
        const val ACTION_UPDATE_DATA = "com.quickora.qpartner.ACTION_UPDATE_OVERLAY_DATA"
        const val ACTION_START_RINGING = "com.quickora.qpartner.ACTION_START_RINGING"
        const val ACTION_STOP_RINGING = "com.quickora.qpartner.ACTION_STOP_RINGING"
        const val ACTION_ACCEPT_ORDER = "com.quickora.qpartner.ACTION_ACCEPT_ORDER"
        const val ACTION_DECLINE_ORDER = "com.quickora.qpartner.ACTION_DECLINE_ORDER"
        const val ACTION_VIEW_ORDER = "com.quickora.qpartner.ACTION_VIEW_ORDER"
        const val ACTION_APP_FOREGROUND = "com.quickora.qpartner.ACTION_APP_FOREGROUND"
        const val ACTION_APP_BACKGROUND = "com.quickora.qpartner.ACTION_APP_BACKGROUND"

        const val ONLINE_CHANNEL_ID = "qpartner_native_online"
        const val CALL_ALERT_CHANNEL_ID = "qpartner_incoming_order_call"
        const val ONLINE_NOTIF_ID = 4101
        const val ORDER_ALERT_NOTIF_ID = 4102
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var pollExecutor: ScheduledExecutorService? = null
    private var windowManager: WindowManager? = null
    private var overlayRootView: View? = null
    private var overlayParams: WindowManager.LayoutParams? = null

    private var mediaPlayer: MediaPlayer? = null
    private var fallbackRingtone: Ringtone? = null
    private var vibrator: Vibrator? = null
    private var countdownTimer: CountDownTimer? = null

    private var currentOrderId: String? = null
    private var currentDomain: String = "transport"
    private var currentServiceLabel: String = "Delivery Request"
    private var currentPickup: String = ""
    private var currentDrop: String = ""
    private var currentFare: String = ""
    private var currentDistance: String = ""
    private var isOrderCardExpanded: Boolean = false
    private var isAppInForeground: Boolean = false

    // Dynamic UI references inside overlay card
    private var pillContainer: LinearLayout? = null
    private var orderCardContainer: LinearLayout? = null
    private var tvTimerBadge: TextView? = null
    private var tvServiceBadge: TextView? = null
    private var tvFareValue: TextView? = null
    private var tvDistanceValue: TextView? = null
    private var tvPickupAddress: TextView? = null
    private var tvDropAddress: TextView? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        createNotificationChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START

        when (action) {
            ACTION_STOP -> {
                stopRingingInternal()
                removeOverlayView()
                stopPollingLoop()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START_RINGING -> {
                startRingingInternal()
                return START_STICKY
            }
            ACTION_STOP_RINGING -> {
                stopRingingInternal()
                return START_STICKY
            }
            ACTION_APP_FOREGROUND -> {
                isAppInForeground = true
                // When app is open in foreground, collapse floating pill so it doesn't block in-app UI
                if (!isOrderCardExpanded) {
                    pillContainer?.visibility = View.GONE
                }
                return START_STICKY
            }
            ACTION_APP_BACKGROUND -> {
                isAppInForeground = false
                ensureOverlayAttached()
                if (!isOrderCardExpanded) {
                    pillContainer?.visibility = View.VISIBLE
                }
                return START_STICKY
            }
            ACTION_DECLINE_ORDER -> {
                val targetId = intent?.getStringExtra("orderId") ?: currentOrderId
                if (!targetId.isNullOrEmpty()) {
                    markOrderHandledInPrefs(targetId)
                }
                dismissActiveOrderCard()
                return START_STICKY
            }
            ACTION_ACCEPT_ORDER, ACTION_VIEW_ORDER -> {
                val targetId = intent?.getStringExtra("orderId") ?: currentOrderId
                val domain = intent?.getStringExtra("domain") ?: currentDomain
                val actType = if (action == ACTION_ACCEPT_ORDER) "accept" else "view"
                if (!targetId.isNullOrEmpty()) {
                    savePendingOrderAction(targetId, domain, actType)
                    markOrderHandledInPrefs(targetId)
                }
                dismissActiveOrderCard()
                launchMainActivityToForeground(targetId, domain, actType)
                return START_STICKY
            }
            ACTION_UPDATE_DATA -> {
                val jsonStr = intent?.getStringExtra("jsonData") ?: "{}"
                handleWidgetDataJson(jsonStr)
            }
        }

        // Ensure foreground service notification is running
        startForegroundWithType(buildOnlineNotification("You're Online — Searching for orders"))
        ensureOverlayAttached()
        startPollingLoop()

        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // When user swipes QPartner from Recents while ONLINE, keep the service alive!
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val isOnline = prefs.getBoolean("is_online", false)
        isAppInForeground = false
        if (isOnline) {
            val restartIntent = Intent(applicationContext, DriverOverlayService::class.java).apply {
                action = ACTION_APP_BACKGROUND
            }
            val pendingIntent = PendingIntent.getService(
                applicationContext,
                1,
                restartIntent,
                PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
            )
            val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            alarmManager.set(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + 800,
                pendingIntent
            )
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        stopRingingInternal()
        removeOverlayView()
        stopPollingLoop()
        super.onDestroy()
    }

    private fun startForegroundWithType(notification: Notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    ONLINE_NOTIF_ID,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(ONLINE_NOTIF_ID, notification)
            }
        } catch (e: Exception) {
            try {
                startForeground(ONLINE_NOTIF_ID, notification)
            } catch (_: Exception) {}
        }
    }

    // ─── Native 5-Second Supabase Background Polling (Works Even When App is Closed) ───
    private fun startPollingLoop() {
        if (pollExecutor != null && !pollExecutor!!.isShutdown) return
        pollExecutor = Executors.newSingleThreadScheduledExecutor()
        pollExecutor?.scheduleWithFixedDelay({
            try {
                pollSupabaseForIncomingOrders()
            } catch (_: Exception) {}
        }, 2, 5, TimeUnit.SECONDS)
    }

    private fun stopPollingLoop() {
        try {
            pollExecutor?.shutdownNow()
        } catch (_: Exception) {}
        pollExecutor = null
    }

    private fun pollSupabaseForIncomingOrders() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val isOnline = prefs.getBoolean("is_online", false)
        if (!isOnline) return

        val supabaseUrl = prefs.getString("supabase_url", null)?.trimEnd('/') ?: return
        val supabaseKey = prefs.getString("supabase_key", null) ?: return
        val driverId = prefs.getString("driver_id", null) ?: return
        val serviceTypesJson = prefs.getString("service_types", "[]") ?: "[]"
        val isBike = prefs.getBoolean("is_bike", false)

        // 1. Check if driver already has an active ride
        val activeUrl = "$supabaseUrl/rest/v1/rides?driver_id=eq.\${URLEncoder.encode(driverId, "UTF-8")}&status=in.(accepted,picked_up,on_ride)&select=id&limit=1"
        val activeArr = httpGetJsonArray(activeUrl, supabaseKey)
        if (activeArr != null && activeArr.length() > 0) {
            return
        }

        // Parse eligible service types
        val allowedTypes = mutableSetOf<String>()
        try {
            val arr = JSONArray(serviceTypesJson)
            for (i in 0 until arr.length()) {
                allowedTypes.add(arr.getString(i))
            }
        } catch (_: Exception) {}

        // 2. Poll unassigned pending transport rides
        val ridesUrl = "$supabaseUrl/rest/v1/rides?status=eq.pending&driver_id=is.null&select=id,service_type,fare,distance_km,pickup_address,drop_address,details,created_at&order=created_at.desc&limit=10"
        val ridesArr = httpGetJsonArray(ridesUrl, supabaseKey)
        if (ridesArr != null) {
            for (i in 0 until ridesArr.length()) {
                val ride = ridesArr.getJSONObject(i)
                val rideId = ride.optString("id", "")
                val svcType = ride.optString("service_type", "taxi_bike")
                if (rideId.isEmpty() || isOrderHandledInPrefs(rideId)) continue
                if (allowedTypes.isNotEmpty() && !allowedTypes.contains(svcType)) continue

                val fare = ride.optString("fare", "0")
                val dist = ride.optString("distance_km", "")
                val pickup = ride.optString("pickup_address", "Pickup Location")
                val drop = ride.optString("drop_address", "Drop Location")
                val label = mapServiceLabel(svcType, "transport")

                mainHandler.post {
                    triggerIncomingOrderAlert(
                        orderId = rideId,
                        domain = "transport",
                        serviceLabel = label,
                        fare = "₹$fare",
                        distance = if (dist.isNotEmpty() && dist != "null") "$dist km" else "",
                        pickup = pickup,
                        drop = drop
                    )
                }
                return
            }
        }

        // 3. If bike partner, also poll unassigned preparing food/grocery orders
        if (isBike) {
            val ordersUrl = "$supabaseUrl/rest/v1/orders?status=eq.preparing&store_type=in.(food,grocery)&select=id,store_type,delivery_fee,total,delivery_address,distance_km,created_at&order=created_at.desc&limit=10"
            val ordersArr = httpGetJsonArray(ordersUrl, supabaseKey)
            if (ordersArr != null) {
                for (i in 0 until ordersArr.length()) {
                    val order = ordersArr.getJSONObject(i)
                    val orderId = order.optString("id", "")
                    if (orderId.isEmpty() || isOrderHandledInPrefs(orderId)) continue
                    val storeType = order.optString("store_type", "food")
                    val domain = if (storeType == "grocery") "grocery" else "food"
                    val fee = order.optDouble("delivery_fee", 35.0)
                    val dist = order.optString("distance_km", "")
                    val drop = order.optString("delivery_address", "Customer Delivery Address")
                    val label = mapServiceLabel(storeType, domain)

                    mainHandler.post {
                        triggerIncomingOrderAlert(
                            orderId = orderId,
                            domain = domain,
                            serviceLabel = label,
                            fare = "₹\${fee.toInt()}",
                            distance = if (dist.isNotEmpty() && dist != "null") "$dist km" else "",
                            pickup = "Partner Store Pickup",
                            drop = drop
                        )
                    }
                    return
                }
            }
        }
    }

    private fun httpGetJsonArray(urlStr: String, apiKey: String): JSONArray? {
        var conn: HttpURLConnection? = null
        return try {
            val url = URL(urlStr)
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 4000
                readTimeout = 4000
                setRequestProperty("apikey", apiKey)
                setRequestProperty("Authorization", "Bearer $apiKey")
                setRequestProperty("Accept", "application/json")
            }
            if (conn.responseCode in 200..299) {
                val reader = BufferedReader(InputStreamReader(conn.inputStream))
                val sb = StringBuilder()
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    sb.append(line)
                }
                reader.close()
                JSONArray(sb.toString())
            } else {
                null
            }
        } catch (_: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    private fun mapServiceLabel(serviceType: String, domain: String): String {
        if (domain == "food") return "🍔 Food Delivery"
        if (domain == "grocery") return "🛒 Grocery Delivery"
        return when (serviceType.lowercase()) {
            "taxi_bike", "bike_taxi", "bike" -> "🏍️ Bike Taxi / Delivery"
            "log_bike", "parcel" -> "📦 Bike Parcel / Logistics"
            "taxi_auto", "auto" -> "🛺 Auto Ride"
            "taxi_car", "cab", "log_cab", "log_car", "car" -> "🚗 Cab Ride"
            "log_mini_auto", "log_mini_truck", "mini_truck" -> "🛻 Tata Ace / Mini Truck"
            "log_truck", "truck" -> "🚚 Pickup Truck"
            else -> "⚡ Quickora Order"
        }
    }

    // ─── Handle JS Bridge Updates ───
    private fun handleWidgetDataJson(jsonStr: String) {
        try {
            val obj = JSONObject(jsonStr)
            val status = obj.optString("status", "searching")
            if (status == "order") {
                val orderId = obj.optString("orderId", currentOrderId ?: "live_order")
                if (isOrderHandledInPrefs(orderId)) return
                val domain = obj.optString("domain", "transport")
                val pickup = obj.optString("pickup", "Pickup Location")
                val drop = obj.optString("drop", "Drop Location")
                val fare = obj.optString("fare", "₹0")
                val distance = obj.optString("distance", "")
                val serviceLabel = obj.optString("serviceLabel", mapServiceLabel(obj.optString("serviceType", "taxi_bike"), domain))
                triggerIncomingOrderAlert(orderId, domain, serviceLabel, fare, distance, pickup, drop)
            } else if (status == "searching") {
                if (!isOrderCardExpanded) {
                    pillContainer?.visibility = if (isAppInForeground) View.GONE else View.VISIBLE
                    orderCardContainer?.visibility = View.GONE
                }
            }
        } catch (_: Exception) {}
    }

    // ─── Incoming Order Alert: Wake Screen + Floating Card + Full-Screen Notification + Ringing ───
    private fun triggerIncomingOrderAlert(
        orderId: String,
        domain: String,
        serviceLabel: String,
        fare: String,
        distance: String,
        pickup: String,
        drop: String
    ) {
        if (currentOrderId == orderId && isOrderCardExpanded) {
            return
        }

        currentOrderId = orderId
        currentDomain = domain
        currentServiceLabel = serviceLabel
        currentFare = fare
        currentDistance = distance
        currentPickup = pickup
        currentDrop = drop
        isOrderCardExpanded = true

        wakeDeviceScreen()
        startRingingInternal()
        showCallStyleOrderNotification(orderId, domain, serviceLabel, fare, distance, pickup, drop)

        // Update Floating Overlay Card if Draw Over Other Apps is permitted
        ensureOverlayAttached()
        tvServiceBadge?.text = serviceLabel
        tvFareValue?.text = fare
        tvDistanceValue?.text = if (distance.isNotEmpty()) "• $distance" else ""
        tvPickupAddress?.text = pickup
        tvDropAddress?.text = if (drop.isNotEmpty()) drop else "Customer Drop Location"

        pillContainer?.visibility = View.GONE
        orderCardContainer?.visibility = View.VISIBLE
        updateOverlayLayoutWidth(expanded = true)

        countdownTimer?.cancel()
        countdownTimer = object : CountDownTimer(30_000, 1_000) {
            override fun onTick(millisUntilFinished: Long) {
                val secs = (millisUntilFinished / 1000).toInt()
                tvTimerBadge?.text = "⏱ \${secs}s"
            }

            override fun onFinish() {
                markOrderHandledInPrefs(orderId)
                dismissActiveOrderCard()
            }
        }.start()
    }

    private fun dismissActiveOrderCard() {
        countdownTimer?.cancel()
        countdownTimer = null
        stopRingingInternal()
        isOrderCardExpanded = false
        currentOrderId = null

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(ORDER_ALERT_NOTIF_ID)

        orderCardContainer?.visibility = View.GONE
        pillContainer?.visibility = if (isAppInForeground) View.GONE else View.VISIBLE
        updateOverlayLayoutWidth(expanded = false)
    }

    private fun wakeDeviceScreen() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            val wl = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                        PowerManager.ACQUIRE_CAUSES_WAKEUP or
                        PowerManager.ON_AFTER_RELEASE,
                "qpartner:incoming_order_wake"
            )
            wl.acquire(15_000L)
        } catch (_: Exception) {}
    }

    // ─── Floating Overlay Window (Rapido / Zomato / YouTube Style) ───
    private fun canDrawOverlays(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else {
            true
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun ensureOverlayAttached() {
        if (!canDrawOverlays()) return
        if (overlayRootView != null) return

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        // 1. Compact Floating Online Pill (Draggable)
        val pill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(8), dp(14), dp(8))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(24).toFloat()
                setColor(Color.parseColor("#0F172A"))
                setStroke(dp(2), Color.parseColor("#22C55E"))
            }
            visibility = if (isAppInForeground) View.GONE else View.VISIBLE
        }

        val dotView = TextView(this).apply {
            text = "🟢 "
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        }
        val pillLabel = TextView(this).apply {
            text = "QPartner Online"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
        }
        pill.addView(dotView)
        pill.addView(pillLabel)

        pill.setOnClickListener {
            launchMainActivityToForeground(null, "transport", "open")
        }

        // 2. Expanded Incoming Order Receiver Card (Rapido / Zomato Style)
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(16))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(20).toFloat()
                setColor(Color.parseColor("#FFFFFF"))
                setStroke(dp(2), Color.parseColor("#1565C0"))
            }
            visibility = View.GONE
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                elevation = dp(12).toFloat()
            }
        }

        // Top Header Row: Badge + Countdown Timer
        val headerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val serviceBadge = TextView(this).apply {
            text = "🏍️ Bike Taxi / Delivery"
            setTextColor(Color.parseColor("#1565C0"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val timerBadge = TextView(this).apply {
            text = "⏱ 30s"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(10), dp(4), dp(10), dp(4))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(Color.parseColor("#DC2626"))
            }
        }
        headerRow.addView(serviceBadge)
        headerRow.addView(timerBadge)

        // Fare + Distance Row
        val fareRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(10), 0, dp(10))
        }
        val fareText = TextView(this).apply {
            text = "₹180"
            setTextColor(Color.parseColor("#16A34A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            typeface = Typeface.DEFAULT_BOLD
        }
        val distText = TextView(this).apply {
            text = "• 4.5 km"
            setTextColor(Color.parseColor("#475569"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(8), 0, 0, 0)
        }
        fareRow.addView(fareText)
        fareRow.addView(distText)

        // Pickup & Drop Section
        val routeBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(Color.parseColor("#F8FAFC"))
                setStroke(dp(1), Color.parseColor("#E2E8F0"))
            }
        }
        val pickupLbl = TextView(this).apply {
            text = "📍 PICKUP"
            setTextColor(Color.parseColor("#16A34A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.DEFAULT_BOLD
        }
        val pickupVal = TextView(this).apply {
            text = "Pickup Location"
            setTextColor(Color.parseColor("#0F172A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(2), 0, dp(8))
        }
        val dropLbl = TextView(this).apply {
            text = "🏁 DROP"
            setTextColor(Color.parseColor("#DC2626"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.DEFAULT_BOLD
        }
        val dropVal = TextView(this).apply {
            text = "Drop Location"
            setTextColor(Color.parseColor("#0F172A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            setPadding(0, dp(2), 0, 0)
        }
        routeBox.addView(pickupLbl)
        routeBox.addView(pickupVal)
        routeBox.addView(dropLbl)
        routeBox.addView(dropVal)

        // Action Buttons Row: Decline & Accept
        val actionsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(14), 0, 0)
        }
        val btnDecline = Button(this).apply {
            text = "Decline"
            isAllCaps = false
            setTextColor(Color.parseColor("#DC2626"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(Color.parseColor("#FEF2F2"))
                setStroke(dp(1), Color.parseColor("#FECACA"))
            }
            layoutParams = LinearLayout.LayoutParams(0, dp(46), 1f).apply {
                rightMargin = dp(8)
            }
            setOnClickListener {
                val id = currentOrderId
                if (!id.isNullOrEmpty()) {
                    markOrderHandledInPrefs(id)
                }
                dismissActiveOrderCard()
            }
        }
        val btnAccept = Button(this).apply {
            text = "✅ Accept Order"
            isAllCaps = false
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable().apply {
                cornerRadius = dp(12).toFloat()
                setColor(Color.parseColor("#16A34A"))
            }
            layoutParams = LinearLayout.LayoutParams(0, dp(46), 1.4f)
            setOnClickListener {
                val id = currentOrderId
                val dom = currentDomain
                if (!id.isNullOrEmpty()) {
                    savePendingOrderAction(id, dom, "accept")
                    markOrderHandledInPrefs(id)
                }
                dismissActiveOrderCard()
                launchMainActivityToForeground(id, dom, "accept")
            }
        }
        actionsRow.addView(btnDecline)
        actionsRow.addView(btnAccept)

        card.addView(headerRow)
        card.addView(fareRow)
        card.addView(routeBox)
        card.addView(actionsRow)

        card.setOnClickListener {
            val id = currentOrderId
            val dom = currentDomain
            if (!id.isNullOrEmpty()) {
                savePendingOrderAction(id, dom, "view")
            }
            dismissActiveOrderCard()
            launchMainActivityToForeground(id, dom, "view")
        }

        root.addView(pill)
        root.addView(card)

        pillContainer = pill
        orderCardContainer = card
        tvServiceBadge = serviceBadge
        tvTimerBadge = timerBadge
        tvFareValue = fareText
        tvDistanceValue = distText
        tvPickupAddress = pickupVal
        tvDropAddress = dropVal

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = dp(48)
        }

        // Allow dragging the floating pill vertically
        pill.setOnTouchListener(object : View.OnTouchListener {
            private var initialY = 0
            private var initialTouchY = 0f
            private var moved = false

            override fun onTouch(v: View, event: MotionEvent): Boolean {
                val lp = overlayParams ?: return false
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialY = lp.y
                        initialTouchY = event.rawY
                        moved = false
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dy = (event.rawY - initialTouchY).toInt()
                        if (kotlin.math.abs(dy) > dp(6)) moved = true
                        lp.y = initialY + dy
                        try {
                            windowManager?.updateViewLayout(overlayRootView, lp)
                        } catch (_: Exception) {}
                        return true
                    }
                    MotionEvent.ACTION_UP -> {
                        if (!moved) {
                            v.performClick()
                        }
                        return true
                    }
                }
                return false
            }
        })

        try {
            windowManager?.addView(root, params)
            overlayRootView = root
            overlayParams = params
        } catch (_: Exception) {}
    }

    private fun updateOverlayLayoutWidth(expanded: Boolean) {
        val root = overlayRootView ?: return
        val params = overlayParams ?: return
        val screenWidth = resources.displayMetrics.widthPixels
        params.width = if (expanded) (screenWidth - dp(24)) else WindowManager.LayoutParams.WRAP_CONTENT
        try {
            windowManager?.updateViewLayout(root, params)
        } catch (_: Exception) {}
    }

    private fun removeOverlayView() {
        countdownTimer?.cancel()
        countdownTimer = null
        val view = overlayRootView
        if (view != null) {
            try {
                windowManager?.removeView(view)
            } catch (_: Exception) {}
        }
        overlayRootView = null
        overlayParams = null
    }

    // ─── Continuous Alarm Sound & Vibration ───
    private fun startRingingInternal() {
        stopRingingInternal()
        try {
            val resId = resources.getIdentifier("booking_alert", "raw", packageName)
            if (resId != 0) {
                mediaPlayer = MediaPlayer.create(this, resId)?.apply {
                    isLooping = true
                    start()
                }
            } else {
                val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                fallbackRingtone = RingtoneManager.getRingtone(applicationContext, uri)?.apply {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        isLooping = true
                    }
                    play()
                }
            }
        } catch (_: Exception) {}

        try {
            val pattern = longArrayOf(0, 600, 300, 600, 300, 600)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
        } catch (_: Exception) {}
    }

    private fun stopRingingInternal() {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
        } catch (_: Exception) {}
        mediaPlayer = null

        try {
            fallbackRingtone?.stop()
        } catch (_: Exception) {}
        fallbackRingtone = null

        try {
            vibrator?.cancel()
        } catch (_: Exception) {}
    }

    // ─── Notifications (Online Sticky + WhatsApp-Call-Style FullScreenIntent) ───
    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val onlineChannel = NotificationChannel(
            ONLINE_CHANNEL_ID,
            "Partner Online Service",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps QPartner connected for incoming orders in the background"
            setShowBadge(false)
        }

        val callChannel = NotificationChannel(
            CALL_ALERT_CHANNEL_ID,
            "Incoming Order Call Alerts",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Full-screen incoming order alerts with sound and vibration"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 600, 300, 600)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            setBypassDnd(true)
        }

        nm.createNotificationChannel(onlineChannel)
        nm.createNotificationChannel(callChannel)
    }

    private fun buildOnlineNotification(text: String): Notification {
        val openIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this,
            100,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, ONLINE_CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("Quickora Partner")
            .setContentText(text)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build()
    }

    private fun showCallStyleOrderNotification(
        orderId: String,
        domain: String,
        serviceLabel: String,
        fare: String,
        distance: String,
        pickup: String,
        drop: String
    ) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val fullScreenIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("qpartner_order_id", orderId)
            putExtra("qpartner_domain", domain)
            putExtra("qpartner_action", "view")
        }
        val fullScreenPi = PendingIntent.getActivity(
            this,
            201,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val acceptIntent = Intent(this, DriverOverlayService::class.java).apply {
            action = ACTION_ACCEPT_ORDER
            putExtra("orderId", orderId)
            putExtra("domain", domain)
        }
        val acceptPi = PendingIntent.getService(
            this,
            202,
            acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val declineIntent = Intent(this, DriverOverlayService::class.java).apply {
            action = ACTION_DECLINE_ORDER
            putExtra("orderId", orderId)
            putExtra("domain", domain)
        }
        val declinePi = PendingIntent.getService(
            this,
            203,
            declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val distPart = if (distance.isNotEmpty()) " • $distance" else ""
        val title = "New Quickora Order • $serviceLabel"
        val body = "$fare$distPart • Respond within 30s\\n📍 $pickup → 🏁 $drop"

        val builder = NotificationCompat.Builder(this, CALL_ALERT_CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle(title)
            .setContentText("$fare$distPart • 📍 $pickup")
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullScreenPi)
            .setFullScreenIntent(fullScreenPi, true)
            .addAction(0, "✅ Accept", acceptPi)
            .addAction(0, "❌ Decline", declinePi)

        nm.notify(ORDER_ALERT_NOTIF_ID, builder.build())
    }

    private fun launchMainActivityToForeground(orderId: String?, domain: String, actionType: String) {
        try {
            val launchIntent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
                if (!orderId.isNullOrEmpty()) {
                    putExtra("qpartner_order_id", orderId)
                    putExtra("qpartner_domain", domain)
                    putExtra("qpartner_action", actionType)
                }
            }
            startActivity(launchIntent)
        } catch (_: Exception) {}
    }

    // ─── SharedPreferences Helpers ───
    private fun isOrderHandledInPrefs(orderId: String): Boolean {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString("handled_order_ids", "[]") ?: "[]"
        return try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                if (arr.getString(i) == orderId) return true
            }
            false
        } catch (_: Exception) {
            false
        }
    }

    private fun markOrderHandledInPrefs(orderId: String) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString("handled_order_ids", "[]") ?: "[]"
        try {
            val arr = JSONArray(raw)
            val list = mutableListOf<String>()
            for (i in 0 until arr.length()) {
                list.add(arr.getString(i))
            }
            if (!list.contains(orderId)) {
                list.add(orderId)
            }
            val trimmed = if (list.size > 60) list.subList(list.size - 60, list.size) else list
            val out = JSONArray()
            trimmed.forEach { out.put(it) }
            prefs.edit().putString("handled_order_ids", out.toString()).apply()
        } catch (_: Exception) {}
    }

    private fun savePendingOrderAction(orderId: String, domain: String, actionType: String) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString("pending_order_id", orderId)
            .putString("pending_domain", domain)
            .putString("pending_action", actionType)
            .putLong("pending_timestamp", System.currentTimeMillis())
            .apply()
    }
}
`;

const DRIVER_SERVICE_MODULE_KT = `package ${PACKAGE_NAME}

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.*
import org.json.JSONArray

class DriverServiceModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "DriverServiceModule"

    @ReactMethod
    fun startFloatingWidget() {
        val intent = Intent(reactContext, DriverOverlayService::class.java).apply {
            action = DriverOverlayService.ACTION_START
        }
        startOverlayServiceCompat(intent)
    }

    @ReactMethod
    fun stopFloatingWidget() {
        val prefs = reactContext.getSharedPreferences(DriverOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean("is_online", false).apply()
        val intent = Intent(reactContext, DriverOverlayService::class.java).apply {
            action = DriverOverlayService.ACTION_STOP
        }
        try {
            reactContext.startService(intent)
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun updateFloatingWidgetData(jsonData: String) {
        val intent = Intent(reactContext, DriverOverlayService::class.java).apply {
            action = DriverOverlayService.ACTION_UPDATE_DATA
            putExtra("jsonData", jsonData)
        }
        startOverlayServiceCompat(intent)
    }

    @ReactMethod
    fun setAppForegroundState(inForeground: Boolean) {
        val prefs = reactContext.getSharedPreferences(DriverOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
        if (!prefs.getBoolean("is_online", false)) return
        val intent = Intent(reactContext, DriverOverlayService::class.java).apply {
            action = if (inForeground) DriverOverlayService.ACTION_APP_FOREGROUND else DriverOverlayService.ACTION_APP_BACKGROUND
        }
        startOverlayServiceCompat(intent)
    }

    @ReactMethod
    fun syncDriverSession(
        supabaseUrl: String,
        supabaseKey: String,
        driverId: String,
        serviceTypesJson: String,
        isBike: Boolean,
        isOnline: Boolean
    ) {
        val prefs = reactContext.getSharedPreferences(DriverOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString("supabase_url", supabaseUrl)
            .putString("supabase_key", supabaseKey)
            .putString("driver_id", driverId)
            .putString("service_types", serviceTypesJson)
            .putBoolean("is_bike", isBike)
            .putBoolean("is_online", isOnline)
            .apply()

        if (isOnline) {
            startFloatingWidget()
        } else {
            stopFloatingWidget()
        }
    }

    @ReactMethod
    fun markOrderHandled(orderId: String) {
        if (orderId.isEmpty()) return
        val prefs = reactContext.getSharedPreferences(DriverOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString("handled_order_ids", "[]") ?: "[]"
        try {
            val arr = JSONArray(raw)
            val list = mutableListOf<String>()
            for (i in 0 until arr.length()) {
                list.add(arr.getString(i))
            }
            if (!list.contains(orderId)) {
                list.add(orderId)
            }
            val out = JSONArray()
            list.takeLast(60).forEach { out.put(it) }
            prefs.edit().putString("handled_order_ids", out.toString()).apply()
        } catch (_: Exception) {}

        val intent = Intent(reactContext, DriverOverlayService::class.java).apply {
            action = DriverOverlayService.ACTION_DECLINE_ORDER
            putExtra("orderId", orderId)
        }
        try {
            reactContext.startService(intent)
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun consumePendingOrderAction(promise: Promise) {
        try {
            val prefs = reactContext.getSharedPreferences(DriverOverlayService.PREFS_NAME, Context.MODE_PRIVATE)
            val orderId = prefs.getString("pending_order_id", null)
            val domain = prefs.getString("pending_domain", "transport") ?: "transport"
            val action = prefs.getString("pending_action", "view") ?: "view"
            val ts = prefs.getLong("pending_timestamp", 0L)

            if (orderId.isNullOrEmpty() || System.currentTimeMillis() - ts > 120_000L) {
                promise.resolve(null)
                return
            }

            prefs.edit()
                .remove("pending_order_id")
                .remove("pending_domain")
                .remove("pending_action")
                .remove("pending_timestamp")
                .apply()

            val map = Arguments.createMap().apply {
                putString("orderId", orderId)
                putString("domain", domain)
                putString("action", action)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.resolve(null)
        }
    }

    @ReactMethod
    fun startRinging() {
        val intent = Intent(reactContext, DriverOverlayService::class.java).apply {
            action = DriverOverlayService.ACTION_START_RINGING
        }
        startOverlayServiceCompat(intent)
    }

    @ReactMethod
    fun stopRinging() {
        val intent = Intent(reactContext, DriverOverlayService::class.java).apply {
            action = DriverOverlayService.ACTION_STOP_RINGING
        }
        try {
            reactContext.startService(intent)
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun checkDrawOverAppsPermission(promise: Promise) {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(reactContext)
        } else {
            true
        }
        promise.resolve(granted)
    }

    @ReactMethod
    fun requestDrawOverAppsPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:\${reactContext.packageName}")
            ).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            reactContext.startActivity(intent)
        }
    }

    private fun startOverlayServiceCompat(intent: Intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                reactContext.startForegroundService(intent)
            } else {
                reactContext.startService(intent)
            }
        } catch (_: Exception) {
            try {
                reactContext.startService(intent)
            } catch (_: Exception) {}
        }
    }
}
`;

const DRIVER_SERVICE_PACKAGE_KT = `package ${PACKAGE_NAME}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class DriverServicePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(DriverServiceModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
`;

function withDriverOverlayManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;

    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const requiredPermissions = [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
      'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
      'android.permission.WAKE_LOCK',
      'android.permission.VIBRATE',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ];

    for (const perm of requiredPermissions) {
      const exists = manifest['uses-permission'].some(
        (p) => p.$ && p.$['android:name'] === perm
      );
      if (!exists) {
        manifest['uses-permission'].push({
          $: { 'android:name': perm },
        });
      }
    }

    const app = manifest.application?.[0];
    if (app) {
      // Enable turnScreenOn and showWhenLocked on MainActivity so incoming order alerts wake lock screen
      const mainActivity = app.activity?.find(
        (a) => a.$ && (a.$['android:name'] === '.MainActivity' || a.$['android:name']?.endsWith('.MainActivity'))
      );
      if (mainActivity && mainActivity.$) {
        mainActivity.$['android:showWhenLocked'] = 'true';
        mainActivity.$['android:turnScreenOn'] = 'true';
      }

      if (!app.service) {
        app.service = [];
      }

      const serviceExists = app.service.some(
        (s) => s.$ && s.$['android:name'] === '.DriverOverlayService'
      );

      if (!serviceExists) {
        app.service.push({
          $: {
            'android:name': '.DriverOverlayService',
            'android:enabled': 'true',
            'android:exported': 'false',
            'android:stopWithTask': 'false',
            'android:foregroundServiceType': 'specialUse',
          },
          property: [
            {
              $: {
                'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
                'android:value': 'Real-time delivery partner order receiver and dispatch alert overlay',
              },
            },
          ],
        });
      }
    }

    return modConfig;
  });
}

function withDriverOverlayMainApplication(config) {
  return withMainApplication(config, (modConfig) => {
    let contents = modConfig.modResults.contents;
    if (!contents.includes('DriverServicePackage()')) {
      if (contents.includes('PackageList(this).packages.apply {')) {
        contents = contents.replace(
          'PackageList(this).packages.apply {',
          'PackageList(this).packages.apply {\n              add(DriverServicePackage())'
        );
      } else if (contents.includes('val packages = PackageList(this).packages')) {
        contents = contents.replace(
          'val packages = PackageList(this).packages',
          'val packages = PackageList(this).packages.toMutableList()\n            packages.add(DriverServicePackage())'
        );
      }
      modConfig.modResults.contents = contents;
    }
    return modConfig;
  });
}

function withDriverOverlayKotlinFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const javaDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        ...PACKAGE_PATH.split('/')
      );

      fs.mkdirSync(javaDir, { recursive: true });

      fs.writeFileSync(
        path.join(javaDir, 'DriverOverlayService.kt'),
        DRIVER_OVERLAY_SERVICE_KT,
        'utf8'
      );
      fs.writeFileSync(
        path.join(javaDir, 'DriverServiceModule.kt'),
        DRIVER_SERVICE_MODULE_KT,
        'utf8'
      );
      fs.writeFileSync(
        path.join(javaDir, 'DriverServicePackage.kt'),
        DRIVER_SERVICE_PACKAGE_KT,
        'utf8'
      );

      return modConfig;
    },
  ]);
}

module.exports = function withDriverOverlayService(config) {
  config = withDriverOverlayManifest(config);
  config = withDriverOverlayMainApplication(config);
  config = withDriverOverlayKotlinFiles(config);
  return config;
};

