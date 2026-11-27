import { useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

const FEATURES = [
  "Expo Router — add a file under app/ and it becomes a screen",
  "NativeWind — Tailwind classes on React Native views",
  "A design system — colour roles and ready components in components/ui",
  "One codebase — iOS, Android, and the web via Expo",
];

export default function Home() {
  const [taps, setTaps] = useState(0);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="gap-7 px-6 py-8">
        <View className="gap-2">
          <Text variant="h1" className="text-left">
            {{projectName}}
          </Text>
          <Text className="text-base leading-6 text-muted-foreground">
            A React Native app built with Expo. Edit app/index.tsx and it reloads
            here.
          </Text>
        </View>

        <Button className="self-start" onPress={() => setTaps((count) => count + 1)}>
          <Text>
            Tapped {taps} {taps === 1 ? "time" : "times"}
          </Text>
        </Button>

        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What&apos;s set up
          </Text>
          {FEATURES.map((item) => (
            <Card key={item} className="py-3">
              <CardContent className="px-4">
                <Text className="text-sm leading-5">{item}</Text>
              </CardContent>
            </Card>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
