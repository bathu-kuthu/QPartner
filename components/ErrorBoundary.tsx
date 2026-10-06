import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, Fonts } from '@/constants/colors';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('[ErrorBoundary] Uncaught application error:', error, errorInfo);
        // If Sentry / Crashlytics SDK is configured, log error here
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <SafeAreaView style={styles.container}>
                    <View style={styles.content}>
                        <View style={styles.iconCircle}>
                            <Feather name="alert-triangle" size={40} color={colors.warning} />
                        </View>
                        <Text style={styles.title}>Something went wrong</Text>
                        <Text style={styles.message}>
                            An unexpected error occurred in the application. You can try reloading the screen.
                        </Text>
                        {this.state.error?.message && (
                            <View style={styles.errorBox}>
                                <Text style={styles.errorText} numberOfLines={3}>
                                    {this.state.error.message}
                                </Text>
                            </View>
                        )}
                        <TouchableOpacity
                            style={styles.retryButton}
                            onPress={this.handleReset}
                            activeOpacity={0.8}
                        >
                            <Feather name="refresh-cw" size={18} color={colors.white} />
                            <Text style={styles.retryText}>Reload Screen</Text>
                        </TouchableOpacity>
                    </View>
                </SafeAreaView>
            );
        }

        return this.props.children;
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.background,
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        width: '88%',
        alignItems: 'center',
        padding: 24,
        backgroundColor: colors.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 5,
    },
    iconCircle: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: colors.warningLight,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontFamily: Fonts.bold,
        fontSize: 20,
        color: colors.text,
        marginBottom: 8,
        textAlign: 'center',
    },
    message: {
        fontFamily: Fonts.regular,
        fontSize: 14,
        color: colors.textSecondary,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 16,
    },
    errorBox: {
        width: '100%',
        backgroundColor: colors.background,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: 20,
    },
    errorText: {
        fontFamily: Fonts.regular,
        fontSize: 12,
        color: colors.error,
    },
    retryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: colors.primary,
        paddingHorizontal: 24,
        paddingVertical: 14,
        borderRadius: 14,
        width: '100%',
    },
    retryText: {
        fontFamily: Fonts.bold,
        fontSize: 16,
        color: colors.white,
    },
});
