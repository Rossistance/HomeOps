// A location you can pick, open, and change.
//
// Three items from the event sheet in the 2026-07-25 walkthrough, all about the same field:
//   [10:55] "It's just raw text. It needs address autocomplete — smart sorting like most
//           web apps."
//   [11:25] "Once I select the address it should be tappable, or a button beside it, that
//           links me out to Google Maps or Apple Maps."
//   [12:05] "And an edit button for the location."
//
// The third one is what makes the first two work together: once an address has been chosen it
// stops behaving like a text field and starts behaving like a place — you tap it to navigate,
// not to put a cursor in it. Editing is then a deliberate act, which is exactly what he asked
// for and also the only way tapping-to-navigate can be safe.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { api, type AddressSuggestionRec } from "@/lib/api";
import { getLocationContext } from "@/lib/location";
import { openDirections, openInMaps } from "@/lib/maps";
import { useTheme, tapHaptic } from "@/theme";
import { PressableScale, Sym, T } from "@/components/ui";

export function AddressField({ value, onChange, editable, inputStyle, placeholder = "Where is it? (optional)" }: {
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
  inputStyle?: object;
  placeholder?: string;
}) {
  const { colors, spacing, radii } = useTheme();
  // A saved address opens in "chosen" mode; a blank one opens ready to type.
  const [editing, setEditing] = useState(!value);
  const [suggestions, setSuggestions] = useState<AddressSuggestionRec[]>([]);
  const [looking, setLooking] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // Set the moment a suggestion is tapped, so the query that's already in flight for the
  // text we just replaced doesn't re-open the list underneath the chosen address.
  const justPicked = useRef(false);

  useEffect(() => {
    if (!editing) return;
    const q = value.trim();
    if (justPicked.current) { justPicked.current = false; return; }
    if (q.length < 3) { setSuggestions([]); return; }
    let live = true;
    setLooking(true);
    // Debounced: this is a network call on a keystroke.
    const t = setTimeout(() => {
      void (async () => {
        const at = await getLocationContext();
        const s = await api.suggestAddresses(q, at ? { latitude: at.latitude, longitude: at.longitude } : null);
        if (!live) return;
        setSuggestions(s);
        setLooking(false);
      })();
    }, 350);
    return () => { live = false; clearTimeout(t); setLooking(false); };
  }, [value, editing]);

  const choose = (s: AddressSuggestionRec) => {
    justPicked.current = true;
    tapHaptic("select");
    onChange(s.value);
    setSuggestions([]);
    setEditing(false);
    inputRef.current?.blur();
  };

  /* ---- chosen: a place, not a text box ---- */
  if (!editing && value.trim()) {
    return (
      <View style={{ gap: spacing.sm }}>
        <PressableScale
          haptic="select"
          onPress={() => void openInMaps(value)}
          accessibilityRole="link"
          accessibilityLabel={`Open ${value} in Maps`}
          style={{
            flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
            backgroundColor: colors.surfaceSunken, borderRadius: radii.sm, borderCurve: "continuous", padding: spacing.md,
          }}
        >
          <Sym name="mappin.and.ellipse" size={16} color={colors.ember} style={{ marginTop: 2 }} />
          {/* Never clamped — "I can't tell where that's at" was about exactly this string. */}
          <T kind="bodyMedium" color={colors.text} style={{ flex: 1 }}>{value}</T>
          <Sym name="arrow.up.forward.app" size={14} color={colors.textFaint} style={{ marginTop: 3 }} />
        </PressableScale>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <SmallAction icon="location.fill" label="Directions" onPress={() => void openDirections(value)} />
          <SmallAction icon="map" label="Google Maps" onPress={() => void openInMaps(value, "google")} />
          {editable ? (
            <SmallAction
              icon="pencil" label="Edit"
              onPress={() => { setEditing(true); setTimeout(() => inputRef.current?.focus(), 60); }}
            />
          ) : null}
        </View>
      </View>
    );
  }

  /* ---- editing: type, and pick from what comes back ---- */
  return (
    <View style={{ gap: 6 }}>
      <View style={{
        flexDirection: "row", alignItems: "center", gap: spacing.sm,
        backgroundColor: colors.surfaceSunken, borderRadius: radii.sm, borderCurve: "continuous",
        paddingHorizontal: spacing.md,
      }}>
        <Sym name="mappin.and.ellipse" size={16} color={colors.textFaint} />
        <TextInput
          ref={inputRef}
          style={[inputStyle, { flex: 1 }]}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          value={value}
          // Addresses are long: wrap rather than scrolling them out of sight.
          multiline
          submitBehavior="blurAndSubmit"
          onChangeText={(t) => onChange(t.replace(/[\r\n]+/g, " "))}
          onSubmitEditing={() => { if (value.trim()) setEditing(false); }}
          editable={editable}
          accessibilityLabel="Event location"
          returnKeyType="done"
        />
        {looking ? <ActivityIndicator size="small" color={colors.textFaint} /> : null}
        {value.trim() && !looking ? (
          <PressableScale
            onPress={() => { setEditing(false); setSuggestions([]); }}
            hitSlop={10} haptic="select"
            accessibilityRole="button" accessibilityLabel="Use this address"
          >
            <Sym name="checkmark.circle.fill" size={18} color={colors.sage} />
          </PressableScale>
        ) : null}
      </View>

      {suggestions.length > 0 ? (
        <View style={{ backgroundColor: colors.surface, borderRadius: radii.sm, borderCurve: "continuous", borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
          {suggestions.map((s, i) => (
            <PressableScale
              key={`${s.value}-${i}`}
              haptic={null}
              onPress={() => choose(s)}
              accessibilityRole="button"
              accessibilityLabel={`${s.label}. ${s.detail}`}
              style={{
                flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
                paddingHorizontal: spacing.md, paddingVertical: 10,
                borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border,
              }}
            >
              <Sym name="mappin" size={13} color={colors.textFaint} style={{ marginTop: 3 }} />
              <View style={{ flex: 1 }}>
                <T kind="subMedium" color={colors.text}>{s.label}</T>
                {s.detail ? <T kind="caption" color={colors.textFaint}>{s.detail}</T> : null}
              </View>
            </PressableScale>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SmallAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flexDirection: "row", alignItems: "center", gap: 5,
        paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999,
        borderWidth: 1, borderColor: colors.border,
      }}
    >
      <Sym name={icon} size={12} color={colors.ember} />
      <T kind="subMedium" color={colors.ember}>{label}</T>
    </PressableScale>
  );
}
