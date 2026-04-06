import React, { useRef, useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    ActivityIndicator, Share, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';

// ─── Full T&C HTML (embedded — no internet required) ──────────────────────────
const TERMS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
  <title>Quickora – Terms &amp; Conditions</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      line-height: 1.7;
      color: #1a1a2e;
      background: #f8faff;
      padding: 16px 16px 40px;
    }
    /* Hero banner */
    .hero {
      background: linear-gradient(135deg, #1a56a0 0%, #0e3a75 100%);
      border-radius: 16px;
      padding: 24px 20px;
      text-align: center;
      margin-bottom: 20px;
    }
    .hero-brand {
      font-size: 26px;
      font-weight: 800;
      color: #fff;
      letter-spacing: 1px;
    }
    .hero-sub {
      font-size: 13px;
      color: rgba(255,255,255,0.75);
      margin-top: 4px;
    }
    .hero-title {
      font-size: 15px;
      font-weight: 700;
      color: #fff;
      margin-top: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .hero-dates {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-top: 12px;
    }
    .hero-date-pill {
      background: rgba(255,255,255,0.15);
      border-radius: 8px;
      padding: 4px 12px;
      font-size: 11px;
      color: rgba(255,255,255,0.9);
    }
    /* Warning box */
    .warning-box {
      background: #fff8e1;
      border-left: 4px solid #f59e0b;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 20px;
    }
    .warning-box strong { color: #b45309; display: block; margin-bottom: 6px; }
    .warning-box p { font-size: 13px; color: #78350f; }
    /* Info table */
    .info-table {
      width: 100%;
      border-collapse: collapse;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 20px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .info-table tr:nth-child(odd)  td:first-child { background: #d6e4f7; }
    .info-table tr:nth-child(even) td:first-child { background: #e8f0fb; }
    .info-table td {
      padding: 10px 14px;
      font-size: 13px;
      border-bottom: 1px solid #dde9f8;
      vertical-align: top;
    }
    .info-table td:first-child {
      font-weight: 700;
      color: #1a56a0;
      width: 38%;
    }
    .info-table td:last-child { color: #2d3748; }
    /* Services table */
    .services-table {
      width: 100%;
      border-collapse: collapse;
      border-radius: 12px;
      overflow: hidden;
      margin: 12px 0 20px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }
    .services-table thead tr { background: #1a56a0; }
    .services-table thead th {
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 700;
      color: #fff;
      text-align: left;
    }
    .services-table tbody tr:nth-child(odd)  { background: #fff; }
    .services-table tbody tr:nth-child(even) { background: #f0f5ff; }
    .services-table td {
      padding: 9px 12px;
      font-size: 13px;
      color: #2d3748;
      border-bottom: 1px solid #dde9f8;
    }
    /* Section headings */
    .section-title {
      font-size: 15px;
      font-weight: 800;
      color: #1a56a0;
      margin: 24px 0 10px;
      padding-bottom: 6px;
      border-bottom: 2px solid #d6e4f7;
    }
    .sub-title {
      font-size: 13px;
      font-weight: 700;
      color: #1a56a0;
      margin: 14px 0 6px;
    }
    /* Paragraphs & lists */
    p { margin-bottom: 10px; font-size: 13px; }
    ul { padding-left: 20px; margin-bottom: 12px; }
    li { margin-bottom: 6px; font-size: 13px; }
    /* Liability box */
    .liability-box {
      background: #fff0f0;
      border-left: 4px solid #ef4444;
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 20px;
    }
    .liability-box ul { margin-top: 8px; }
    .liability-box .note {
      font-weight: 700;
      color: #b91c1c;
      margin-top: 10px;
      font-size: 13px;
    }
    /* Acknowledgement box */
    .ack-box {
      background: linear-gradient(135deg, #e8f0fb 0%, #d6e4f7 100%);
      border-radius: 12px;
      padding: 18px 16px;
      margin-top: 24px;
    }
    .ack-box strong {
      display: block;
      font-size: 14px;
      color: #1a56a0;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .ack-box p { font-size: 13px; color: #2d3748; margin-bottom: 8px; }
    /* End line */
    .end-line {
      text-align: center;
      color: #94a3b8;
      font-size: 12px;
      margin-top: 24px;
      font-style: italic;
    }
  </style>
</head>
<body>

<!-- Hero -->
<div class="hero">
  <div class="hero-brand">QUICKORA</div>
  <div class="hero-sub">Taxi &amp; Logistics Platform</div>
  <div class="hero-title">Terms &amp; Conditions</div>
  <div class="hero-dates">
    <span class="hero-date-pill">Effective: 01 Jan 2025</span>
    <span class="hero-date-pill">Updated: 01 Jan 2025</span>
  </div>
</div>

<!-- Warning -->
<div class="warning-box">
  <strong>⚠ PLEASE READ CAREFULLY BEFORE USING THIS APP</strong>
  <p>By downloading, registering, or using the Quickora application, you confirm that you have read, understood, and agreed to be bound by these Terms and Conditions. If you do not agree, please do not use this application.</p>
</div>

<!-- 1. About -->
<div class="section-title">1. About Quickora</div>
<p>Quickora is a technology platform that connects Customers who need transportation or logistics services with independent Driver partners. Quickora does not operate taxis or transport vehicles directly. The company acts solely as an intermediary facilitating ride-booking and logistics coordination.</p>
<table class="info-table">
  <tr><td>App Name</td><td>Quickora</td></tr>
  <tr><td>Services Offered</td><td>City Taxi, Outstation Rides, Parcel &amp; Goods Logistics</td></tr>
  <tr><td>Platform Type</td><td>Two-sided Marketplace (Customer ↔ Driver)</td></tr>
  <tr><td>Governing Laws</td><td>Laws of India — IT Act 2000, Consumer Protection Act 2019, MV Act 1988, DPDP Act 2023</td></tr>
  <tr><td>Jurisdiction</td><td>Courts of Sathyamangalam, India</td></tr>
</table>

<!-- 2. Eligibility -->
<div class="section-title">2. Eligibility &amp; Account Registration</div>
<div class="sub-title">2.1 Who Can Use This App</div>
<ul>
  <li>You must be at least 18 years of age to register and use Quickora.</li>
  <li>You must provide accurate, complete, and current information during registration.</li>
  <li>You must have legal capacity to enter into a binding agreement under applicable law.</li>
  <li>Accounts are non-transferable. You are responsible for all activity under your account.</li>
</ul>
<div class="sub-title">2.2 Driver Eligibility</div>
<ul>
  <li>Must hold a valid Indian driving licence for the class of vehicle being operated.</li>
  <li>Must have a vehicle that is registered, insured, and roadworthy under the Motor Vehicles Act, 1988.</li>
  <li>Must clear background verification as required by Quickora.</li>
  <li>Must not have any criminal conviction related to violence, fraud, or motor vehicle offences.</li>
</ul>

<!-- 3. Services -->
<div class="section-title">3. Services Provided</div>
<p>Quickora offers the following categories of service through the platform:</p>
<table class="services-table">
  <thead><tr><th>Service</th><th>Description</th><th>Availability</th></tr></thead>
  <tbody>
    <tr><td>City Taxi</td><td>On-demand cab booking within city limits</td><td>24/7</td></tr>
    <tr><td>Outstation Rides</td><td>Long-distance travel between cities</td><td>Scheduled</td></tr>
    <tr><td>Parcel Delivery</td><td>Small package &amp; document courier</td><td>As Available</td></tr>
    <tr><td>Goods Logistics</td><td>Larger consignment transport via goods vehicles</td><td>Advance Booking</td></tr>
  </tbody>
</table>

<!-- 4. Booking & Payments -->
<div class="section-title">4. Booking, Pricing &amp; Payments</div>
<div class="sub-title">4.1 Booking Process</div>
<ul>
  <li>Bookings are confirmed only upon receiving an in-app confirmation message and/or driver assignment.</li>
  <li>Quickora reserves the right to cancel bookings in case of non-availability of drivers or safety concerns.</li>
  <li>Customers are responsible for providing the correct pick-up and drop location. Errors causing additional distance will be charged accordingly.</li>
</ul>
<div class="sub-title">4.2 Pricing &amp; Surge</div>
<ul>
  <li>Fares are calculated based on distance, time, vehicle type, and prevailing demand (surge pricing may apply).</li>
  <li>Estimated fares shown at booking are indicative. Final fare may vary due to route changes, tolls, or waiting time.</li>
  <li>All applicable taxes will be levied as per Indian GST regulations.</li>
</ul>
<div class="sub-title">4.3 Payment</div>
<ul>
  <li>Customers may pay via in-app wallet, UPI, debit/credit card, or cash (where enabled).</li>
  <li>All digital payments are processed through PCI-DSS compliant third-party payment gateways. Quickora does not store card details.</li>
  <li>Receipts will be issued electronically via the app or email.</li>
  <li>Disputes over payment must be raised within 7 days of the trip date.</li>
</ul>

<!-- 5. Cancellation -->
<div class="section-title">5. Cancellation &amp; Refund Policy</div>
<div class="sub-title">5.1 Customer Cancellations</div>
<ul>
  <li>Cancellation within 3 minutes of booking: No charge.</li>
  <li>Cancellation after 3 minutes but before driver arrival: A nominal cancellation fee applies.</li>
  <li>No-show (Customer absent at pick-up location): Full waiting charge applicable.</li>
</ul>
<div class="sub-title">5.2 Driver Cancellations</div>
<ul>
  <li>Drivers who repeatedly cancel confirmed bookings may face account suspension.</li>
  <li>If a driver cancels after acceptance, the Customer will be re-matched immediately at no extra cost.</li>
</ul>
<div class="sub-title">5.3 Refunds</div>
<ul>
  <li>Refunds for eligible cancellations or overcharges will be processed within 5–7 working days to the original payment source.</li>
  <li>Cash payments are non-refundable through digital channels.</li>
</ul>

<!-- 6. Customer Conduct -->
<div class="section-title">6. Customer Responsibilities &amp; Conduct</div>
<p>Customers agree to:</p>
<ul>
  <li>Behave respectfully and courteously towards Driver partners at all times.</li>
  <li>Not carry illegal goods, hazardous materials, or substances prohibited by law.</li>
  <li>Not request drivers to violate traffic laws, speed limits, or take unauthorised routes.</li>
  <li>Not record, photograph, or harass driver partners without consent.</li>
  <li>Ensure minor passengers (under 18) are accompanied by a responsible adult.</li>
  <li>Not leave the vehicle in an unclean or damaged condition.</li>
</ul>
<p>Violation of the above may result in account suspension, trip termination, or legal action.</p>

<!-- 7. Driver Conduct -->
<div class="section-title">7. Driver Partner Responsibilities &amp; Conduct</div>
<p>Driver partners agree to:</p>
<ul>
  <li>Maintain a valid driving licence, vehicle registration, insurance, and fitness certificate at all times.</li>
  <li>Keep the vehicle clean, safe, and roadworthy at all times.</li>
  <li>Follow all applicable traffic laws, road regulations, and Motor Vehicles Act provisions.</li>
  <li>Treat all Customers with courtesy and professionalism regardless of background.</li>
  <li>Not consume alcohol or any intoxicants before or during a trip.</li>
  <li>Not share Customer personal data with any third party.</li>
  <li>Not deviate from the app-assigned route without Customer consent.</li>
  <li>Maintain their availability status accurately on the app.</li>
</ul>
<p>Serious or repeated violations will result in immediate deactivation of the driver account without notice.</p>

<!-- 8. Logistics -->
<div class="section-title">8. Logistics &amp; Parcel Services — Special Terms</div>
<ul>
  <li>Customers must declare the correct nature, value, and weight of goods. Quickora is not liable for loss/damage caused by incorrect declarations.</li>
  <li>Prohibited items include: contraband, narcotics, flammable materials, perishables (unless specified), live animals, and currency.</li>
  <li>Logistics liability is capped at INR 5,000 per consignment unless extra insurance is opted for at booking.</li>
  <li>Quickora does not guarantee delivery timelines; estimated delivery windows are indicative only.</li>
  <li>Customers must ensure proper packaging of goods. Damage due to poor packaging is not covered.</li>
</ul>

<!-- 9. Liability -->
<div class="section-title">9. Limitation of Liability</div>
<div class="liability-box">
  <p>To the maximum extent permitted by applicable law:</p>
  <ul>
    <li>Quickora is a technology intermediary, not a transport operator. Any liability for accidents, theft, injury, or loss during a ride lies primarily with the Driver, who is an independent service provider.</li>
    <li>Quickora is not liable for delays caused by traffic, weather, natural disasters, or Force Majeure events.</li>
    <li>Quickora's aggregate liability to any Customer or Driver for any claim shall not exceed the value of the trip in question.</li>
    <li>Quickora shall not be liable for any indirect, incidental, special, or consequential damages including loss of income, data, or business opportunity.</li>
  </ul>
  <p class="note">Nothing in this clause limits liability for death or personal injury caused by Quickora's own gross negligence.</p>
</div>

<!-- 10. Privacy -->
<div class="section-title">10. Data Privacy &amp; Protection</div>
<p>Quickora collects, processes, and stores personal data in compliance with the Digital Personal Data Protection Act, 2023 (DPDP Act) and applicable Indian law.</p>
<ul>
  <li>Data collected: Name, phone number, location, payment details, trip history.</li>
  <li>Purpose: Service delivery, safety, fraud prevention, legal compliance.</li>
  <li>Your data will not be sold to third parties for commercial advertising.</li>
  <li>Location data is collected only during active sessions.</li>
  <li>You may request data deletion by contacting privacy@quickora.app.</li>
  <li>By using the app, you consent to these data practices as described in our full Privacy Policy (available on the app).</li>
</ul>

<!-- 11. Safety -->
<div class="section-title">11. Safety &amp; Emergency</div>
<ul>
  <li>The app includes an in-trip SOS feature accessible at all times during a ride.</li>
  <li>Customers and Drivers can report safety concerns via the in-app help centre or by calling our 24/7 safety helpline.</li>
  <li>All incidents of serious nature will be reported to relevant law enforcement authorities.</li>
  <li>Quickora reserves the right to share trip data, location, and user details with police or courts under valid legal order.</li>
</ul>

<!-- 12. IP -->
<div class="section-title">12. Intellectual Property</div>
<p>All content, software, trademarks, and designs in the Quickora application are the exclusive property of Quickora and are protected under applicable intellectual property laws. Users may not copy, reproduce, distribute, or create derivative works without written permission from Quickora.</p>

<!-- 13. Termination -->
<div class="section-title">13. Account Suspension &amp; Termination</div>
<ul>
  <li>Quickora reserves the right to suspend or permanently terminate any account found in violation of these Terms without prior notice.</li>
  <li>Users may close their account at any time by submitting a request via the app. Pending dues must be cleared before closure.</li>
  <li>Upon termination, your access to the platform ceases immediately. Transaction history may be retained as required by law.</li>
</ul>

<!-- 14. Disputes -->
<div class="section-title">14. Dispute Resolution</div>
<div class="sub-title">14.1 Internal Grievance</div>
<p>All disputes must first be raised through the Quickora in-app Grievance Mechanism. Our support team will respond within 48 hours.</p>
<div class="sub-title">14.2 Arbitration</div>
<p>If unresolved within 30 days, disputes shall be referred to binding arbitration under the Arbitration and Conciliation Act, 1996 (India). The seat of arbitration shall be Sathyamangalam, India.</p>
<div class="sub-title">14.3 Governing Law</div>
<p>These Terms are governed by the laws of India. Subject to arbitration, the courts at Sathyamangalam shall have exclusive jurisdiction.</p>

<!-- 15. Changes -->
<div class="section-title">15. Changes to These Terms</div>
<p>Quickora reserves the right to modify these Terms at any time. Updated Terms will be posted within the app and on our website with the revised effective date. Continued use of the app after changes constitutes acceptance of the revised Terms.</p>

<!-- 16. Contact -->
<div class="section-title">16. Contact &amp; Grievance Officer</div>
<table class="info-table">
  <tr><td>Company Name</td><td>Quickora Taxi &amp; Logistics Pvt. Ltd.</td></tr>
  <tr><td>Registered Office</td><td>Kavilipalayam, Nambiyur (Tk), Erode (Dt) - 638458, Tamil Nadu, India</td></tr>
  <tr><td>Grievance Officer</td><td>Bathmakumar P</td></tr>
  <tr><td>Email</td><td>quickoraqc@gmail.com</td></tr>
  <tr><td>Phone</td><td>+91 97157 49855</td></tr>
  <tr><td>Working Hours</td><td>Monday – Saturday, 9:00 AM – 6:00 PM IST</td></tr>
</table>

<!-- Acknowledgement -->
<div class="ack-box">
  <strong>Acknowledgement</strong>
  <p>By clicking 'I Agree', creating an account, or using any feature of the Quickora application, you acknowledge that you have read and fully understood these Terms and Conditions, and agree to be legally bound by them.</p>
  <p>These Terms constitute the entire agreement between you and Quickora with respect to your use of the platform and supersede all prior agreements.</p>
</div>

<div class="end-line">— End of Terms and Conditions —</div>

</body>
</html>`;

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function TermsScreen() {
    const insets = useSafeAreaInsets();
    const webViewRef = useRef<WebView>(null);
    const [loading, setLoading] = useState(true);

    const handleShare = async () => {
        try {
            await Share.share({
                title: 'Quickora – Terms & Conditions',
                message: 'Quickora Taxi & Logistics – Terms & Conditions\n\nEffective: 01 January 2025\nContact: quickoraqc@gmail.com | +91 97157 49855\nGrievance Officer: Bathmakumar P\nAddress: Kavilipalayam, Nambiyur (Tk), Erode (Dt) - 638458, Tamil Nadu, India',
            });
        } catch (_) { }
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
                    <Feather name="arrow-left" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Terms &amp; Conditions</Text>
                <TouchableOpacity onPress={handleShare} style={styles.shareBtn} activeOpacity={0.7}>
                    <Feather name="share-2" size={20} color={colors.primary} />
                </TouchableOpacity>
            </View>

            {/* WebView */}
            <WebView
                ref={webViewRef}
                source={{ html: TERMS_HTML }}
                style={styles.webView}
                originWhitelist={['*']}
                showsVerticalScrollIndicator={false}
                onLoadStart={() => setLoading(true)}
                onLoadEnd={() => setLoading(false)}
                // Disable external navigation — all content is local
                onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith('data:') || req.url === 'about:srcdoc'}
            />

            {loading && (
                <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            )}

            {/* Footer */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 8 }]}>
                <Feather name="shield" size={13} color={colors.textMuted} />
                <Text style={styles.footerText}>
                    Quickora Taxi &amp; Logistics Pvt. Ltd. · Effective 01 Jan 2025
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12,
        backgroundColor: colors.surface,
        borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    backBtn: { padding: 4, marginRight: 8 },
    headerTitle: {
        flex: 1, fontFamily: Fonts.bold, fontSize: 17, color: colors.text,
    },
    shareBtn: { padding: 4 },
    webView: { flex: 1, backgroundColor: colors.background },
    loadingOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center', alignItems: 'center',
        backgroundColor: colors.background,
    },
    footer: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingTop: 8, paddingHorizontal: 16,
        backgroundColor: colors.surface,
        borderTopWidth: 1, borderTopColor: colors.border,
    },
    footerText: {
        fontFamily: Fonts.regular, fontSize: 11, color: colors.textMuted,
        textAlign: 'center',
    },
});