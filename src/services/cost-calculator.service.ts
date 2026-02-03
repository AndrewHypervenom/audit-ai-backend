//backend/src/services/cost-calculator.service.ts

import { logger } from '../utils/logger.js';
import type { APICosts } from '../types/index.js';

/**
 * Precios actualizados a Enero 2026
 * Fuentes:
 * - AssemblyAI: https://www.assemblyai.com/pricing
 * - OpenAI GPT-4o: https://openai.com/api/pricing/
 */
class CostCalculatorService {
  // ============================================
  // PRECIOS ASSEMBLYAI (Enero 2026)
  // ============================================
  private readonly ASSEMBLYAI_COST_PER_MINUTE = 0.00037; // $0.00037 por minuto

  // ============================================
  // PRECIOS OPENAI GPT-4o (Enero 2026)
  // ============================================
  private readonly GPT4O_INPUT_COST_PER_1M = 2.50; // $2.50 por 1M tokens de input
  private readonly GPT4O_OUTPUT_COST_PER_1M = 10.00; // $10.00 por 1M tokens de output

  /**
   * Calcular costo de transcripción de AssemblyAI
   */
  calculateAssemblyAICost(audioDurationSeconds: number): {
    audioDurationMinutes: number;
    costPerMinute: number;
    totalCost: number;
  } {
    const durationMinutes = audioDurationSeconds / 60;
    const totalCost = durationMinutes * this.ASSEMBLYAI_COST_PER_MINUTE;

    logger.info('💰 AssemblyAI cost calculated', {
      durationMinutes: durationMinutes.toFixed(2),
      costPerMinute: this.ASSEMBLYAI_COST_PER_MINUTE,
      totalCost: `$${totalCost.toFixed(4)}`
    });

    return {
      audioDurationMinutes: parseFloat(durationMinutes.toFixed(2)),
      costPerMinute: this.ASSEMBLYAI_COST_PER_MINUTE,
      totalCost: parseFloat(totalCost.toFixed(4))
    };
  }

  /**
   * Calcular costo de análisis de imágenes con GPT-4o
   */
  calculateImageAnalysisCost(
    imageCount: number,
    totalInputTokens: number,
    totalOutputTokens: number
  ): {
    count: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  } {
    const inputCost = (totalInputTokens / 1_000_000) * this.GPT4O_INPUT_COST_PER_1M;
    const outputCost = (totalOutputTokens / 1_000_000) * this.GPT4O_OUTPUT_COST_PER_1M;
    const totalCost = inputCost + outputCost;

    logger.info('💰 Image analysis cost calculated', {
      imageCount,
      inputTokens: totalInputTokens.toLocaleString(),
      outputTokens: totalOutputTokens.toLocaleString(),
      inputCost: `$${inputCost.toFixed(4)}`,
      outputCost: `$${outputCost.toFixed(4)}`,
      totalCost: `$${totalCost.toFixed(4)}`
    });

    return {
      count: imageCount,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cost: parseFloat(totalCost.toFixed(4))
    };
  }

  /**
   * Calcular costo de evaluación con GPT-4o
   */
  calculateEvaluationCost(
    inputTokens: number,
    outputTokens: number
  ): {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  } {
    const inputCost = (inputTokens / 1_000_000) * this.GPT4O_INPUT_COST_PER_1M;
    const outputCost = (outputTokens / 1_000_000) * this.GPT4O_OUTPUT_COST_PER_1M;
    const totalCost = inputCost + outputCost;

    logger.info('💰 Evaluation cost calculated', {
      inputTokens: inputTokens.toLocaleString(),
      outputTokens: outputTokens.toLocaleString(),
      inputCost: `$${inputCost.toFixed(4)}`,
      outputCost: `$${outputCost.toFixed(4)}`,
      totalCost: `$${totalCost.toFixed(4)}`
    });

    return {
      inputTokens,
      outputTokens,
      cost: parseFloat(totalCost.toFixed(4))
    };
  }

  /**
   * Calcular costo total de una auditoría completa
   */
  calculateTotalCost(
    audioDurationSeconds: number,
    imageCount: number,
    imageInputTokens: number,
    imageOutputTokens: number,
    evaluationInputTokens: number,
    evaluationOutputTokens: number
  ): APICosts {
    const assemblyaiCost = this.calculateAssemblyAICost(audioDurationSeconds);
    const imagesCost = this.calculateImageAnalysisCost(
      imageCount,
      imageInputTokens,
      imageOutputTokens
    );
    const evaluationCost = this.calculateEvaluationCost(
      evaluationInputTokens,
      evaluationOutputTokens
    );

    const openaiTotalCost = imagesCost.cost + evaluationCost.cost;
    const totalCost = assemblyaiCost.totalCost + openaiTotalCost;

    const costs: APICosts = {
      assemblyai: assemblyaiCost,
      openai: {
        images: imagesCost,
        evaluation: evaluationCost,
        totalCost: parseFloat(openaiTotalCost.toFixed(4))
      },
      totalCost: parseFloat(totalCost.toFixed(4)),
      currency: 'USD'
    };

    logger.success('💰 Total audit cost calculated', {
      assemblyai: `$${assemblyaiCost.totalCost.toFixed(4)}`,
      openai: `$${openaiTotalCost.toFixed(4)}`,
      total: `$${totalCost.toFixed(4)}`
    });

    return costs;
  }

  /**
   * Formatear costos para mostrar en logs
   */
  formatCostSummary(costs: APICosts): string {
    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 RESUMEN DE COSTOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎤 AssemblyAI (Transcripción):
   • Duración: ${costs.assemblyai.audioDurationMinutes} minutos
   • Costo: $${costs.assemblyai.totalCost.toFixed(4)}

🖼️  OpenAI GPT-4o (Análisis de Imágenes):
   • Imágenes: ${costs.openai.images.count}
   • Input tokens: ${costs.openai.images.inputTokens.toLocaleString()}
   • Output tokens: ${costs.openai.images.outputTokens.toLocaleString()}
   • Costo: $${costs.openai.images.cost.toFixed(4)}

🧠 OpenAI GPT-4o (Evaluación):
   • Input tokens: ${costs.openai.evaluation.inputTokens.toLocaleString()}
   • Output tokens: ${costs.openai.evaluation.outputTokens.toLocaleString()}
   • Costo: $${costs.openai.evaluation.cost.toFixed(4)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 TOTAL OPENAI: $${costs.openai.totalCost.toFixed(4)}
💵 COSTO TOTAL: $${costs.totalCost.toFixed(4)} USD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();
  }
}

// Exportar singleton
let instance: CostCalculatorService | null = null;

export const getCostCalculatorService = () => {
  if (!instance) {
    instance = new CostCalculatorService();
  }
  return instance;
};

export const costCalculatorService = getCostCalculatorService();

export { CostCalculatorService };