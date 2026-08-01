import {
  assertCreditAssessmentInput,
  type CreditAssessmentInput,
  type CreditAssessmentResult
} from "@c402/protocol";

export const CREDIT_MODEL_CODE_HASH = "0xcredit_model_v1";
export const CREDIT_OUTPUT_SCHEMA = "credit-score-v1";

export function assessCredit(input: CreditAssessmentInput, now = new Date()): CreditAssessmentResult {
  assertCreditAssessmentInput(input);

  const income = input.monthlyIncomeCents / 100;
  const debt = input.currentDebtCents / 100;
  const averageBalance = input.averageBalanceCents / 100;
  const netCashFlow = input.transactions.reduce((sum, tx) => sum + tx.amountCents, 0) / 100;
  const debtToIncome = income === 0 ? 1 : Math.min(1, debt / Math.max(income, 1));

  let score = 620;
  score += clamp(Math.floor(income / 100), 0, 140);
  score += clamp(Math.floor(averageBalance / 50), -80, 80);
  score += clamp(Math.floor(netCashFlow / 100), -80, 80);
  score -= Math.round(debtToIncome * 160);
  score -= input.overdraftCount90d * 35;
  score -= input.missedPaymentCount12m * 55;
  score = clamp(score, 300, 850);

  const riskBand = score >= 740 ? "A" : score >= 660 ? "B" : score >= 580 ? "C" : "D";
  const approved = score >= 640 && input.overdraftCount90d <= 2 && input.missedPaymentCount12m <= 1;
  const disposableIncome = Math.max(0, income - debt * 0.08);
  const maximumCredit = approved ? Math.min(5000, Math.max(100, Math.floor(disposableIncome * 0.25))) : 0;
  const validUntil = Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60;

  return {
    approved,
    maximumCredit,
    riskBand,
    validUntil
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
