// Without a boundary, ONE bad render unmounts the whole React tree and the app becomes a
// white screen — no message, no way back, and (before crash-reporter.ts) no report either.
// The family's only recourse was to force-quit and hope.
//
// This catches the render, reports it, and offers a way forward. It deliberately does NOT
// try to be clever about recovery: it re-mounts the subtree once when asked, and if that
// fails again it says so plainly rather than flickering between broken states.
import { Component, type ReactNode } from "react";
import { View, Text, Pressable } from "react-native";
import { reportCrash } from "@/lib/crash-reporter";

interface Props { children: ReactNode; screen?: string }
interface State { error: Error | null; retried: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retried: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // The component stack is what makes a render error actionable — the JS stack alone
    // often points at React internals rather than the component that actually threw.
    reportCrash(error, { fatal: false, screen: this.props.screen ?? info.componentStack?.trim().split("\n")[0] });
  }

  render() {
    const { error, retried } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12, backgroundColor: "#10141E" }}>
        <Text style={{ color: "#F5F3EF", fontSize: 19, fontWeight: "600", textAlign: "center" }}>
          This screen ran into a problem
        </Text>
        <Text style={{ color: "#A8A29E", fontSize: 14, lineHeight: 20, textAlign: "center" }}>
          {retried
            ? "It didn't recover on a second try, so something here needs a fix. The problem has been reported to your household's log — nothing you entered elsewhere is affected."
            : "The problem has been reported to your household's log. Nothing you entered elsewhere is affected."}
        </Text>
        {!retried && (
          <Pressable
            onPress={() => this.setState({ error: null, retried: true })}
            accessibilityRole="button"
            accessibilityLabel="Try this screen again"
            style={{ marginTop: 6, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 14, backgroundColor: "#E0662C" }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "600" }}>Try again</Text>
          </Pressable>
        )}
      </View>
    );
  }
}
