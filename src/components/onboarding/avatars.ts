import male1 from "@/assets/avatars/male-1.png";
import male2 from "@/assets/avatars/male-2.png";
import male3 from "@/assets/avatars/male-3.png";
import female1 from "@/assets/avatars/female-1.png";
import female2 from "@/assets/avatars/female-2.png";
import female3 from "@/assets/avatars/female-3.png";
import neutral1 from "@/assets/avatars/neutral-1.png";
import neutral2 from "@/assets/avatars/neutral-2.png";
import neutral3 from "@/assets/avatars/neutral-3.png";

export type Gender = "male" | "female" | "prefer_not_to_say";

export const AVATAR_PRESETS: Record<Gender, { id: string; src: string }[]> = {
  male: [
    { id: "male-1", src: male1 },
    { id: "male-2", src: male2 },
    { id: "male-3", src: male3 },
  ],
  female: [
    { id: "female-1", src: female1 },
    { id: "female-2", src: female2 },
    { id: "female-3", src: female3 },
  ],
  prefer_not_to_say: [
    { id: "neutral-1", src: neutral1 },
    { id: "neutral-2", src: neutral2 },
    { id: "neutral-3", src: neutral3 },
  ],
};
