import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** 炉心光晕：与阅读页 glowCore 一致，不依赖字体。 */
export default function Icon() {
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
          borderRadius: 8
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "radial-gradient(circle at 50% 42%, #f0c878 0%, #e8b86d 35%, #a06828 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 10px rgba(232, 184, 109, 0.55)"
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
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
