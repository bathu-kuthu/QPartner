import React, { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import * as ImageManipulator from 'expo-image-manipulator';
import { Feather } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';

interface ImageEditorModalProps {
    visible: boolean;
    imageUri: string;
    onCancel: () => void;
    onApply: (uri: string, size: number) => void;
}

export default function ImageEditorModal({ visible, imageUri, onCancel, onApply }: ImageEditorModalProps) {
    const webviewRef = useRef<WebView>(null);
    const [base64Img, setBase64Img] = useState<string>('');
    const [processing, setProcessing] = useState(true);

    useEffect(() => {
        if (visible && imageUri) {
            setProcessing(true);
            fetch(imageUri)
                .then(res => res.blob())
                .then(blob => {
                    return new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                })
                .then(base64Url => {
                    setBase64Img(base64Url);
                    setProcessing(false);
                })
                .catch(err => {
                    console.error('Image read error:', err);
                    Alert.alert('Error', 'Failed to read image.');
                    setProcessing(false);
                });
        }
    }, [visible, imageUri]);

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      <link href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.css" rel="stylesheet">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js"></script>
      <style>
        body { margin: 0; background: #000; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
        img { max-width: 100%; display: block; }
        .container { flex: 1; display: flex; justify-content: center; align-items: center; height: 100%; }
      </style>
    </head>
    <body>
      <div class="container">
        <img id="image" src="${base64Img}">
      </div>
      <script>
        let cropper;
        window.onload = function() {
            const image = document.getElementById('image');
            cropper = new Cropper(image, {
                viewMode: 1,
                dragMode: 'move',
                autoCropArea: 0.8,
                restore: false,
                guides: true,
                center: true,
                highlight: false,
                cropBoxMovable: true,
                cropBoxResizable: true,
                toggleDragModeOnDblclick: false,
            });
        };
        
        // Listen for messages from React Native
        document.addEventListener('message', function(e) {
            handleAction(e.data);
        });
        window.addEventListener('message', function(e) {
            handleAction(e.data);
        });

        function handleAction(action) {
            if (action === 'getCrop') {
                try {
                    const data = cropper.getData(true);
                    window.ReactNativeWebView.postMessage(JSON.stringify(data));
                } catch (err) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ error: err.message }));
                }
            }
        }
      </script>
    </body>
    </html>
    `;

    const handleApply = () => {
        setProcessing(true);
        webviewRef.current?.postMessage('getCrop');
    };

    const onMessage = async (event: WebViewMessageEvent) => {
        try {
            const dataStr = event.nativeEvent.data;
            const data = JSON.parse(dataStr);
            
            if (data.error) {
                throw new Error(data.error);
            }
            if (typeof data.x !== 'number') {
                throw new Error('Invalid crop data received');
            }

            const originX = Math.max(0, data.x);
            const originY = Math.max(0, data.y);
            const width = Math.max(1, data.width);
            const height = Math.max(1, data.height);

            const result = await ImageManipulator.manipulateAsync(
                imageUri,
                [{ crop: { originX, originY, width, height } }],
                { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
            );
            
            const response = await fetch(result.uri);
            const blob = await response.blob();
            const size = blob.size;
            
            if (size > 2 * 1024 * 1024) {
                Alert.alert('Error', 'Cropped image size exceeds 2 MB.');
                setProcessing(false);
                return;
            }
            
            onApply(result.uri, size);
        } catch (e: any) {
            console.error('Crop Processing Error:', e);
            Alert.alert('Error', e.message || 'Failed to process cropped image.');
            setProcessing(false);
        }
    };

    return (
        <Modal visible={visible} animationType="slide" transparent={false}>
            <View style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={onCancel} style={styles.iconBtn}>
                        <Feather name="x" size={24} color={colors.text} />
                    </TouchableOpacity>
                    <Text style={styles.title}>Crop Image</Text>
                    <TouchableOpacity onPress={handleApply} style={styles.iconBtn} disabled={processing}>
                        <Feather name="check" size={24} color={processing ? colors.textMuted : colors.primary} />
                    </TouchableOpacity>
                </View>

                <View style={styles.contentContainer}>
                    {processing && !base64Img ? (
                        <ActivityIndicator size="large" color={colors.primary} />
                    ) : (
                        <WebView
                            ref={webviewRef}
                            source={{ html: htmlContent }}
                            style={styles.webview}
                            scrollEnabled={false}
                            bounces={false}
                            onMessage={onMessage}
                            showsHorizontalScrollIndicator={false}
                            showsVerticalScrollIndicator={false}
                        />
                    )}
                    {processing && base64Img && (
                        <View style={styles.overlayLoader}>
                            <ActivityIndicator size="large" color={colors.primary} />
                        </View>
                    )}
                </View>
                
                <View style={styles.footer}>
                    <Text style={styles.hint}>Pinch to zoom, drag to move, and adjust corners.</Text>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000', paddingBottom: 30 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60, backgroundColor: colors.surface },
    title: { fontFamily: Fonts.bold, fontSize: 18, color: colors.text },
    iconBtn: { padding: 8 },
    contentContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
    webview: { flex: 1, backgroundColor: '#000' },
    overlayLoader: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
    footer: { padding: 16, backgroundColor: colors.surface, alignItems: 'center' },
    hint: { fontFamily: Fonts.regular, fontSize: 13, color: colors.textMuted, textAlign: 'center' }
});
