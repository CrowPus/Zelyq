import { useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "../components/ThemedText";

const FEATURES = [
  "Expo Router — add a file under app/ and it becomes a screen",
  "NativeWind — Tailwind classes on React Native views",
  "TypeScript — strict, with typed routes",
  "One codebase — iOS, Android, and the web via Expo",
];

export default function Home() {
  const [taps, setTaps] = useState(0);

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="gap-7 px-6 py-8">
        <View className="gap-2">
          <ThemedText className="text-3xl font-bold text-neutral-900">
            {{projectName}}
          </ThemedText>
          <Text className="text-base leading-6 text-neutral-500">
            A React Native app built with Expo. Edit app/index.tsx and it reloads
            here.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => setTaps((count) => count + 1)}
          className="self-start rounded-xl bg-neutral-900 px-5 py-3 active:opacity-80"
        >
          <Text className="text-base font-semibold text-white">
            Tapped {taps} {taps === 1 ? "time" : "times"}
          </Text>
        </Pressable>

        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            What&apos;s set up
          </Text>
          <FlatList
            scrollEnabled={false}
            data={FEATURES}
            keyExtractor={(item) => item}
            ItemSeparatorComponent={() => <View className="h-2" />}
            renderItem={({ item }) => (
              <View className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                <Text className="text-sm leading-5 text-neutral-700">{item}</Text>
              </View>
            )}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
