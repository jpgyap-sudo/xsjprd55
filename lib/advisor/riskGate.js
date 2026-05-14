export function runAdvisorRiskGate(context, score) {
  const warnings = [...(score.warnings || [])];
  let riskScore = 0.35;

  if (context.data_health?.fresh === false) riskScore += 0.25;
  if (context.sentiment?.news === 'conflict') riskScore += 0.15;
  if (context.market?.volatility === 'extreme') riskScore += 0.20;

  riskScore = Math.max(0, Math.min(1, Number(riskScore.toFixed(4))));

  const maxRisk = Number(process.env.ADVISOR_MAX_RISK_SCORE || 0.70);
  let finalBias = score.bias;
  if (riskScore > maxRisk) {
    finalBias = 'avoid';
    warnings.push(`Risk score ${riskScore} exceeds max allowed ${maxRisk}.`);
  }

  return {
    approved_for_advice: true,
    execution_allowed: false,
    riskScore,
    bias: finalBias,
    warnings
  };
}
