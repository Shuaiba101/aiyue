import type { CSSProperties } from "react";

/** 主题动态背景：夜间炉边 · 日间海滩。纯 CSS 动画，无视频资源。 */
export function SceneBackground() {
  return (
    <div className="sceneBg" aria-hidden="true">
      <div className="sceneNight">
        <div className="sceneNightSky" />
        <div className="sceneNightStars" />
        <div className="sceneNightWoods" />
        <div className="sceneCampfire">
          <div className="sceneFireGlow" />
          <div className="sceneFireCore" />
          <div className="sceneFireFlame sceneFireFlameA" />
          <div className="sceneFireFlame sceneFireFlameB" />
          <div className="sceneLogs" />
        </div>
        <div className="sceneEmbers">
          {Array.from({ length: 10 }, (_, i) => (
            <span className="sceneEmber" key={i} style={{ "--i": i } as CSSProperties} />
          ))}
        </div>
      </div>

      <div className="sceneDay">
        <div className="sceneDaySky" />
        <div className="sceneSun" />
        <div className="sceneCloud sceneCloudA" />
        <div className="sceneCloud sceneCloudB" />
        <div className="sceneOcean">
          <div className="sceneWave sceneWaveFar" />
          <div className="sceneWave sceneWaveMid" />
          <div className="sceneWave sceneWaveNear" />
          <div className="sceneShimmer" />
        </div>
        <div className="sceneBeach" />
        <div className="sceneFoam" />
      </div>

      <div className="sceneVignette" />
    </div>
  );
}
