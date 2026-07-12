import { useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { Modal, Button, Field, TextInput, ACCENT_SOLID } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { MemberAvatar } from "@/components/MemberAvatar";
import { backend } from "@/connectors/api";
import type { Member } from "@/types";

// The six selectable member colors — kept in sync with HouseholdSpaces / the server.
const MEMBER_COLORS = ["ink", "sage", "coral", "amber", "sky", "lavender"] as const;
// Curated emoji avatars, saved as `photoFileId: "emoji:🦊"`.
const EMOJI_AVATARS = ["🦊", "🐻", "🦉", "🐙", "🌻", "🍀", "⭐️", "🌈", "🐝", "🦋", "🍕", "⚽️"];

/** Center-crop an uploaded image to a square and downscale it to `size`×`size`, returning
 *  the base64 body of a JPEG (data-URI prefix stripped) ready for the file-upload API.
 *  Keeps avatar thumbnails small so they load fast wherever a member renders. */
function downscaleToJpegBase64(file: File, size = 256): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(undefined); return; }
        const side = Math.min(img.naturalWidth, img.naturalHeight) || size;
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        const uri = canvas.toDataURL("image/jpeg", 0.8);
        resolve(uri.includes(",") ? uri.split(",")[1] : undefined);
      } catch { resolve(undefined); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(undefined); };
    img.src = url;
  });
}

/** "My Profile" editor — edit MY display name, accent color, and avatar (curated emoji
 *  or an uploaded photo). Saves through the server member registry (self-edit of
 *  name/color/photo is allowed for every role). */
export function ProfileEditor({ member, onClose }: { member: Member; onClose: () => void }) {
  const toast = useStore((s) => s.toast);
  const hydrate = useStore((s) => s.hydrateFromServer);
  const [name, setName] = useState(member.displayName);
  const [color, setColor] = useState(member.avatarColor);
  const [photoFileId, setPhotoFileId] = useState<string | null>(member.photoFileId ?? null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const uploadPhoto = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    // Downscale to a small square JPEG before upload so avatar thumbnails stay tiny and
    // load fast everywhere they render (center-cropped to match the round object-cover avatar).
    const base64 = await downscaleToJpegBase64(file, 256);
    if (!base64) { setUploading(false); toast({ kind: "error", title: "Couldn't read that image" }); return; }
    const up = await backend.uploadFile({ name: `${name.trim() || member.displayName} — avatar`, mime: "image/jpeg", contentBase64: base64, tags: ["Avatar"], visibility: "personal", source: "avatar" });
    setUploading(false);
    if (up.file) setPhotoFileId(up.file.id);
    else toast({ kind: "error", title: "Photo upload failed", message: up.message ?? up.error });
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await backend.updateMemberRemote(member.id, { displayName: name.trim(), color, photoFileId });
    setBusy(false);
    if (r.error) {
      toast({ kind: "error", title: "Couldn't save your profile", message: r.message ?? (r.error === "last_owner" ? "The household needs at least one Owner." : r.error) });
      return;
    }
    await hydrate();
    toast({ kind: "success", title: "Profile updated" });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="My Profile" icon="UserCircle"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="ember" disabled={!name.trim() || busy || uploading} onClick={() => void save()}><Icon name={busy ? "Loader2" : "Check"} size={15} className={busy ? "animate-spin" : ""} /> Save</Button></>}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <MemberAvatar initials={member.initials} color={color} photoFileId={photoFileId} size={56} />
          <div className="min-w-0 flex-1">
            <Field label="Display name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></Field>
          </div>
        </div>

        <Field label="Your color">
          <div className="flex flex-wrap items-center gap-2">
            {MEMBER_COLORS.map((c) => (
              <button key={c} onClick={() => setColor(c)} aria-label={`Set your color to ${c}`} aria-pressed={color === c}
                className={cn("h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-surface-raised transition-transform hover:scale-110", ACCENT_SOLID[c], color === c ? "ring-ink-700" : "ring-transparent")} />
            ))}
          </div>
        </Field>

        <Field label="Avatar" hint="Pick an emoji, upload a photo, or keep your initials.">
          <div className="flex flex-wrap items-center gap-1.5">
            {EMOJI_AVATARS.map((e) => {
              const val = `emoji:${e}`;
              const active = photoFileId === val;
              return (
                <button key={e} onClick={() => setPhotoFileId(active ? null : val)} aria-label={`Use ${e} as your avatar`} aria-pressed={active}
                  className={cn("flex h-9 w-9 items-center justify-center rounded-xl border text-lg transition-colors", active ? "border-ember-400 bg-ember-50" : "border-ink-900/[0.08] bg-surface-sunken/60 hover:border-ember-200")}>
                  {e}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void uploadPhoto(e.target.files?.[0] ?? null)} />
            <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Icon name={uploading ? "Loader2" : "ImagePlus"} size={14} className={uploading ? "animate-spin" : ""} /> {uploading ? "Uploading…" : "Upload a photo"}
            </Button>
            {photoFileId && !photoFileId.startsWith("emoji:") && (
              <Button size="sm" variant="ghost" onClick={() => setPhotoFileId(null)}><Icon name="X" size={13} /> Remove photo</Button>
            )}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
