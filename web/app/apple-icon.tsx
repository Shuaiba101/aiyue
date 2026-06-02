import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** iOS / 微信「添加到主屏幕」图标。 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1a1208",
          borderRadius: 36
        }}
      >
        <div
          style={{
            width: 118,
            height: 118,
            borderRadius: "50%",
            background: "radial-gradient(circle at 50% 42%, #f0c878 0%, #e8b86d 35%, #a06828 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 36px rgba(232, 184, 109, 0.5)"
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              background: "#fff8ec"
            }}
          />
        </div>
      </div>
    ),
    { ...size }
  );
}
