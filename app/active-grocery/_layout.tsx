import { Stack } from 'expo-router';

export default function ActiveGroceryLayout() {
    return (
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_bottom', gestureEnabled: false }}>
            <Stack.Screen name="[id]" options={{ gestureEnabled: false }} />
        </Stack>
    );
}
