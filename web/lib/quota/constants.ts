/** 平台免费试读轮数（每轮 = 一次成功 AI 回复，走平台 DeepSeek Key）。 */
export const FREE_TRIAL_TURNS = 30;

export type QuotaPlan = "trial" | "pro";

export type QuotaSnapshot = {
  plan: QuotaPlan;
  turnsUsed: number;
  turnsLimit: number;
  turnsRemaining: number;
  canUsePlatform: boolean;
};
