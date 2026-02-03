//backend/src/services/evaluator.service.ts

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import type { AuditInput, TranscriptResult, ImageAnalysis, EvaluationResult } from '../types/index.js';
import { getCriteriaForCallType, type EvaluationBlock } from '../config/evaluation-criteria.js';
import * as fs from 'fs';

class EvaluatorService {
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    this.client = new OpenAI({ apiKey });
  }

  async evaluate(
    auditInput: AuditInput,
    transcript: TranscriptResult,
    imageAnalyses: ImageAnalysis[]
  ): Promise<Omit<EvaluationResult, 'excelUrl'> & { usage?: { inputTokens: number; outputTokens: number; totalTokens: number } }> {
    try {
      logger.info('Starting ENHANCED evaluation', {
        callType: auditInput.callType,
        executiveId: auditInput.executiveId
      });

      // ✅ NUEVO: Acumuladores de tokens
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      // PASO 1: Análisis estructurado de evidencia visual MEJORADO
      const { visualEvidence, tokensUsed: visualTokens } = await this.extractVisualEvidenceEnhanced(auditInput.imagePaths || []);

      // ✅ NUEVO: Acumular tokens de análisis visual
      totalInputTokens += visualTokens.input;
      totalOutputTokens += visualTokens.output;
      
      logger.info('Visual evidence extracted with enhanced detection', {
        systemsFound: Object.keys(visualEvidence).length,
        totalFindings: Object.values(visualEvidence).flat().length,
        tokensUsed: `${visualTokens.input} input + ${visualTokens.output} output`
      });

      // PASO 2: Análisis de transcripción
      const verbalEvidence = this.extractVerbalEvidence(transcript);
      
      logger.info('Verbal evidence extracted', {
        totalMentions: verbalEvidence.length
      });

      // PASO 3: Obtener criterios
      const criteria = getCriteriaForCallType(auditInput.callType);
      
      // PASO 4: Evaluación con MATCHING MEJORADO
      const { evaluation, tokensUsed: evalTokens } = await this.evaluateWithEnhancedMatching(
        criteria,
        visualEvidence,
        verbalEvidence,
        transcript,
        auditInput
      );

      // ✅ NUEVO: Acumular tokens de evaluación
      totalInputTokens += evalTokens.input;
      totalOutputTokens += evalTokens.output;

      logger.success('Evaluation completed with enhanced matching', {
        totalScore: evaluation.total_score,
        percentage: evaluation.percentage,
        tokensUsed: `${evalTokens.input} input + ${evalTokens.output} output`
      });

      // Transformar a formato de respuesta
      const detailedScores: Array<{
        criterion: string;
        score: number;
        maxScore: number;
        observations: string;
      }> = evaluation.evaluations.map((ev: any) => ({
        criterion: `[${ev.block}] ${ev.topic}`,
        score: ev.score,
        maxScore: ev.max_score,
        observations: ev.justification
      }));

      const keyMoments: Array<{
        timestamp: string;
        type: string;
        description: string;
      }> = evaluation.key_moments?.map((moment: any) => ({
        timestamp: moment.timestamp,
        type: moment.event,
        description: moment.description
      })) || [];

      const result: Omit<EvaluationResult, 'excelUrl'> & { usage: { inputTokens: number; outputTokens: number; totalTokens: number } } = {
        totalScore: evaluation.total_score,
        maxPossibleScore: evaluation.max_possible_score,
        percentage: evaluation.percentage,
        detailedScores,
        observations: evaluation.observations,
        recommendations: evaluation.recommendations || [],
        keyMoments,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens
        }
      };

      logger.info('💰 Total evaluation tokens', {
        input: totalInputTokens.toLocaleString(),
        output: totalOutputTokens.toLocaleString(),
        total: (totalInputTokens + totalOutputTokens).toLocaleString()
      });

      return result;

    } catch (error) {
      logger.error('Error in evaluation', error);
      throw error;
    }
  }

  /**
   * MEJORADO: Extrae evidencia visual con detección más precisa y captura tokens
   */
  private async extractVisualEvidenceEnhanced(imagePaths: string[]): Promise<{
    visualEvidence: Record<string, any[]>;
    tokensUsed: { input: number; output: number };
  }> {
    const evidence: Record<string, any[]> = {};
    // ✅ NUEVO: Acumuladores de tokens
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];
      let attempts = 0;
      const maxAttempts = 3;
      let success = false;

      while (attempts < maxAttempts && !success) {
        try {
          attempts++;
          
          const imageBuffer = fs.readFileSync(imagePath);
          const imageBase64 = imageBuffer.toString('base64');
          const ext = imagePath.split('.').pop()?.toLowerCase();
          const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

          const response = await this.client.chat.completions.create({
            model: 'gpt-4o',
            max_tokens: 4000,
            temperature: 0,
            seed: 42,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${mimeType};base64,${imageBase64}`,
                      detail: 'high'
                    }
                  },
                  {
                    type: 'text',
                    text: this.getEnhancedAnalysisPrompt()
                  }
                ]
              }
            ]
          });

          // ✅ NUEVO: Capturar tokens de uso
          if (response.usage) {
            totalInputTokens += response.usage.prompt_tokens;
            totalOutputTokens += response.usage.completion_tokens;
            logger.info(`📊 Image ${i + 1} analysis tokens: ${response.usage.prompt_tokens} input + ${response.usage.completion_tokens} output`);
          }

          const content = response.choices[0]?.message?.content;
          if (!content) {
            throw new Error('Empty response from OpenAI');
          }

          // Limpieza robusta
          let cleanedContent = content.trim();
          cleanedContent = cleanedContent.replace(/```json\n?/gi, '');
          cleanedContent = cleanedContent.replace(/```\n?/g, '');
          cleanedContent = cleanedContent.replace(/^\uFEFF/, '');
          cleanedContent = cleanedContent.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');

          const parsed = JSON.parse(cleanedContent);
          
          if (!parsed.system || !parsed.data) {
            throw new Error('Invalid JSON structure');
          }

          const system = parsed.system;
          if (!evidence[system]) {
            evidence[system] = [];
          }

          // Guardar TODA la data estructurada con metadatos
          evidence[system].push({
            imagePath,
            data: parsed.data,
            findings: parsed.findings || [],
            confidence: parsed.confidence || 0.9,
            critical_fields: parsed.critical_fields || {}
          });

          success = true;
          logger.info(`Image ${i + 1}/${imagePaths.length} analyzed successfully (attempt ${attempts})`, {
            system,
            fieldsFound: Object.keys(parsed.data).length,
            criticalFieldsFound: Object.keys(parsed.critical_fields || {}).length
          });

        } catch (error: any) {
          logger.warn(`Error analyzing image ${i + 1}, attempt ${attempts}/${maxAttempts}`, {
            error: error.message
          });

          if (attempts >= maxAttempts) {
            logger.error(`Failed to analyze image ${i + 1} after ${maxAttempts} attempts`);
          } else {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    }

    // ✅ NUEVO: Retornar evidencia Y tokens
    logger.info(`💰 Visual evidence extraction total tokens: ${totalInputTokens} input + ${totalOutputTokens} output`);
    
    return {
      visualEvidence: evidence,
      tokensUsed: {
        input: totalInputTokens,
        output: totalOutputTokens
      }
    };
  }

  /**
   * MEJORADO: Prompt con mejor detección de campos críticos
   */
  private getEnhancedAnalysisPrompt(): string {
    return `Analiza esta captura de pantalla de sistema bancario con MÁXIMA PRECISIÓN y EXTRAE TODOS LOS DATOS VISIBLES.

**PASO 1: IDENTIFICA EL SISTEMA**

- **FALCON**: Casos de fraude, números de caso, transacciones marcadas, checkboxes, comentarios de investigación
- **VCAS**: Estados de tarjeta (BLOCKED/BLKI), historial de bloqueos, números de cuenta
- **VISION**: Pantalla ARQE/IBI con códigos de bloqueo (BLKT, BLKI, BNFC, BPT0), fechas de bloqueo
- **VRM**: Visa Risk Manager, búsqueda de cuentas, validaciones
- **BI**: Creación de folios (formato 2540493912), transacciones seleccionadas
- **FRONT**: Registro de casos, codificación, comentarios de gestión
- **OTRO**: Excel, listas de transacciones, documentos

**PASO 2: EXTRAE TODOS LOS CAMPOS VISIBLES**

Lee CADA LÍNEA de texto visible. Para cada sistema, extrae:

# FALCON:
- case_number: Número de caso completo (ej: "6788724")
- case_status: Estado visible (Cerrado/Abierto/En proceso)
- fraud_type: Tipo de fraude seleccionado
- checkboxes_checked: Lista de checkboxes marcados ["Cliente contactado", "Reporte de fraude", "SMS"]
- transactions_marked: true si hay transacciones marcadas como fraude
- transaction_count: Número de transacciones visibles
- comments_present: true si hay comentarios visibles
- comment_text: Texto completo del comentario del cliente si visible

# VCAS:
- account_number: Número de cuenta (16 dígitos)
- account_status: BLOCKED, ACTIVE, etc
- block_date: Fecha de bloqueo si visible (formato: YYYY/MM/DD HH:MM:SS)
- block_user: Usuario que bloqueó
- bypass_status: ON o OFF
- transaction_history_visible: true/false

# VISION:
- account_number: Cuenta visible
- block_code: Código de bloqueo (F, etc)
- block_date: Fecha del bloqueo
- block_types_marked: Lista de tipos ["BLKT", "BLKI", "BNFC"]
- curr_crd_dte: Fecha de tarjeta actual
- card_status_indicators: Estado de la tarjeta

# BI:
- folio_created: true si dice "Se ha creado el folio"
- folio_number: Número completo del folio (ej: "2540493912")
- transactions_selected: true si hay "Transacciones seleccionadas"
- transaction_count: Cantidad de transacciones visibles
- transaction_status: Estado de transacciones ("Abierto", etc)

# VRM:
- search_attempted: true si se ve interfaz de búsqueda
- account_searched: Número de cuenta buscado
- no_results_message: true si dice "No se encontraron cuentas"
- search_criteria: Criterio usado (cuenta/comercio)

# OTRO (Excel/Transacciones):
- transaction_list_visible: true
- transaction_count: Número de filas visibles
- merchants_visible: Lista de comercios ["PPROMEX*MICROSOFT", "NMX*WINNER"]
- amounts_visible: Lista de montos ["$20", "$400"]
- dates_visible: Lista de fechas

**PASO 3: IDENTIFICA CAMPOS CRÍTICOS**

Para cada hallazgo importante, márcalo en "critical_fields":

{
  "has_case_number": true/false,
  "has_blocked_status": true/false,
  "has_folio_number": true/false,
  "has_transactions": true/false,
  "has_fraud_checkboxes": true/false,
  "has_block_codes": true/false
}

**FORMATO DE RESPUESTA JSON:**

\`\`\`json
{
  "system": "FALCON|VCAS|VISION|VRM|BI|FRONT|OTRO",
  "confidence": 0.95,
  "data": {
    "todos_los_campos": "valores_extraidos",
    "lee_todo_el_texto": "visible",
    "no_omitas_nada": "importante"
  },
  "critical_fields": {
    "has_case_number": true,
    "has_blocked_status": false,
    "has_folio_number": true
  },
  "findings": [
    "campo1: valor exacto encontrado con contexto",
    "campo2: true - explicación de dónde se vio",
    "campo3: lista de valores [a, b, c]"
  ]
}
\`\`\`

**REGLAS CRÍTICAS:**
1. Lee TODO el texto visible - no omitas nada
2. Si ves un número, fecha o monto: EXTRÁELO EXACTAMENTE
3. Si ves checkboxes marcados: LISTA TODOS
4. Si ves transacciones: CUENTA CUÁNTAS
5. Si ves códigos de bloqueo (BLKI, BLKT, BNFC): REPÓRTALOS TODOS
6. NO inventes valores - usa null si no está visible
7. SÉ ULTRA específico con cada dato

EJEMPLO DE RESPUESTA CORRECTA:
{
  "system": "FALCON",
  "confidence": 0.98,
  "data": {
    "case_number": "6788724",
    "checkboxes_checked": ["Cliente contactado", "Reporte de fraude", "SMS", "Eliminar bloqueo"],
    "transactions_marked": true,
    "transaction_count": 6,
    "fraud_type": "Fraude de pedido por Internet",
    "comment_text": "Cliente no reconoce movs del 12/10/2025"
  },
  "critical_fields": {
    "has_case_number": true,
    "has_fraud_checkboxes": true,
    "has_transactions": true
  },
  "findings": [
    "case_number: 6788724 visible en Número de caso",
    "checkboxes_checked: 4 checkboxes marcados",
    "transactions_marked: 6 transacciones con marca CNF en tabla",
    "comment_text: Comentario del cliente visible en panel derecho"
  ]
}`;
  }

  /**
   * MEJORADO: Evaluación con matching más preciso y captura de tokens
   */
  private async evaluateWithEnhancedMatching(
    criteria: EvaluationBlock[],
    visualEvidence: Record<string, any[]>,
    verbalEvidence: string[],
    transcript: TranscriptResult,
    auditInput: AuditInput
  ): Promise<{
    evaluation: any;
    tokensUsed: { input: number; output: number };
  }> {
    const topicsToEvaluate = criteria.flatMap(block => 
      block.topics
        .filter(topic => topic.applies)
        .map(topic => ({
          block: block.blockName,
          topic: topic.topic,
          criticality: topic.criticality,
          maxScore: topic.points as number,
          whatToLookFor: topic.whatToLookFor || '',
          system: this.getSystemFromBlock(block.blockName)
        }))
    );

    const maxPossibleScore = topicsToEvaluate.reduce((sum, t) => sum + t.maxScore, 0);

    // Construir prompt con MATCHING MEJORADO
    const prompt = this.buildEnhancedMatchingPrompt(
      auditInput,
      visualEvidence,
      verbalEvidence,
      topicsToEvaluate,
      maxPossibleScore
    );

    const response = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Eres un auditor experto que evalúa con MÁXIMA PRECISIÓN basándose en EVIDENCIA CONCRETA.

**FILOSOFÍA DE CALIFICACIÓN:**

Si la evidencia está presente en los datos estructurados → OTORGA PUNTOS COMPLETOS
Si la evidencia NO está presente → 0 puntos
Si hay duda → Revisa toda la evidencia disponible antes de decidir

**REGLAS DE MATCHING:**

1. CAMPOS CRÍTICOS tienen prioridad absoluta:
   - has_case_number = true → Hay número de caso
   - has_blocked_status = true → La tarjeta está bloqueada
   - has_folio_number = true → El folio fue creado
   - has_fraud_checkboxes = true → Los checkboxes están marcados
   - has_transactions = true → Hay transacciones calificadas

2. Para cada tópico, BUSCA la evidencia específica:
   - "Cierre correcto del caso" → Busca en transcripción menciones de pasos siguientes
   - "Creación y llenado correcto del caso" → Busca case_number + checkboxes + comentarios
   - "Bloquea tarjeta" → Busca account_status: BLOCKED o block_types_marked
   - "Crea el Folio Correctamente" → Busca folio_number y folio_created: true

3. PENALIZA SOLO si la evidencia contradice el criterio:
   - Si dice "Bloquea tarjeta" pero account_status = "ACTIVE" → 0 puntos
   - Si dice "Crea folio" pero folio_created = false → 0 puntos

4. NO PENALICES por ausencia de evidencia si el sistema no aplica:
   - Si no hay imagen de VRM → No se puede validar VRM
   - Si no hay imagen de BI → No se puede validar folio

5. USA TODA LA EVIDENCIA:
   - Combina visual + verbal
   - Si el agente menciona algo en audio Y se ve en imagen → Puntos completos
   - Si solo está en uno → Evalúa si es suficiente

**CRITERIO DE PUNTUACIÓN:**

- Evidencia CLARA y COMPLETA → Puntos completos (100%)
- Evidencia PARCIAL pero válida → Puntos parciales (50-80%)  
- SIN evidencia o evidencia contradictoria → 0 puntos

**NO SEAS CONSERVADOR - SI LA EVIDENCIA EXISTE, ÚSALA**`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0,
      seed: 12345,
      response_format: { type: 'json_object' }
    });

    // ✅ NUEVO: Capturar tokens de evaluación
    const tokensUsed = {
      input: response.usage?.prompt_tokens || 0,
      output: response.usage?.completion_tokens || 0
    };

    logger.info(`💰 Evaluation tokens: ${tokensUsed.input} input + ${tokensUsed.output} output`);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    // ✅ NUEVO: Retornar evaluación Y tokens
    return {
      evaluation: JSON.parse(content),
      tokensUsed
    };
  }

  /**
   * MEJORADO: Prompt con evidencia estructurada más clara
   */
  private buildEnhancedMatchingPrompt(
    auditInput: AuditInput,
    visualEvidence: Record<string, any[]>,
    verbalEvidence: string[],
    topics: any[],
    maxScore: number
  ): string {
    // Formatear evidencia estructurada de forma más clara
    const structuredEvidence = Object.entries(visualEvidence)
      .map(([system, images]) => {
        const fieldsSection = images.map((img, idx) => {
          const dataFields = Object.entries(img.data)
            .map(([key, value]) => {
              const valueStr = typeof value === 'object' 
                ? JSON.stringify(value) 
                : String(value);
              return `    ${key}: ${valueStr}`;
            })
            .join('\n');

          const criticalFields = img.critical_fields 
            ? Object.entries(img.critical_fields)
                .map(([key, value]) => `    ${key}: ${value}`)
                .join('\n')
            : '';
          
          return `📸 Imagen ${idx + 1}: ${img.imagePath.split(/[/\\]/).pop()}

DATOS EXTRAÍDOS:
${dataFields}

CAMPOS CRÍTICOS DETECTADOS:
${criticalFields || '    (ninguno marcado)'}

HALLAZGOS ESPECÍFICOS:
${img.findings.map((f: string) => `  ✓ ${f}`).join('\n')}`;
        }).join('\n\n');

        return `╔═════════════════════════════════════╗
SISTEMA: ${system}
╚═════════════════════════════════════╝

${fieldsSection}`;
      })
      .join('\n\n');

    return `# AUDITORÍA CON EVIDENCIA ESTRUCTURADA MEJORADA

**Información de la Auditoría:**
- Tipo: ${auditInput.callType}
- Ejecutivo: ${auditInput.executiveName} (ID: ${auditInput.executiveId})
- Cliente: ${auditInput.clientId}
- Fecha: ${auditInput.callDate}

╔═════════════════════════════════════╗
EVIDENCIA VISUAL ESTRUCTURADA
╚═════════════════════════════════════╝

${structuredEvidence}

╔═════════════════════════════════════╗
EVIDENCIA VERBAL (Transcripción)
╚═════════════════════════════════════╝

${verbalEvidence.slice(0, 40).join('\n')}

╔═════════════════════════════════════╗
TÓPICOS A EVALUAR
╚═════════════════════════════════════╝

${topics.map((t, i) => `
┌────────────────────────────────────┐
${i + 1}. ${t.topic}
└────────────────────────────────────┘

Bloque: ${t.block}
Sistema: ${t.system}
Puntos máximos: ${t.maxScore}
Criticidad: ${t.criticality}

QUÉ BUSCAR:
${t.whatToLookFor}

INSTRUCCIONES DE MATCHING:

${this.getEnhancedMatchingRulesForTopic(t.topic, t.system)}

CRITERIO DE CALIFICACIÓN:
- Si encuentras la evidencia específica → ${t.maxScore} puntos
- Si la evidencia es parcial → Otorga puntos parciales proporcionalmente
- Si NO hay evidencia o contradice → 0 puntos

IMPORTANTE: Revisa TODA la evidencia (visual + verbal) antes de calificar.
`).join('\n\n')}

╔═════════════════════════════════════╗
FORMATO DE RESPUESTA
╚═════════════════════════════════════╝

Responde con JSON válido siguiendo este formato:

\`\`\`json
{
  "evaluations": [
    {
      "block": "Nombre del bloque",
      "topic": "Nombre del tópico",
      "score": 0 o puntos_completos o puntos_parciales,
      "max_score": puntos_maximos,
      "justification": "EVIDENCIA CONCRETA ENCONTRADA: [cita campos específicos]. Por lo tanto, [conclusión].",
      "evidence": [
        "data.campo1: valor - Fuente: Sistema X, Imagen Y",
        "data.campo2: valor - Fuente: Transcripción, minuto Z",
        "critical_fields.has_xxx: true - Confirmado en análisis visual"
      ],
      "completed": true
    }
  ],
  "total_score": suma_total,
  "max_possible_score": ${maxScore},
  "percentage": (total_score / max_possible_score) * 100,
  "observations": "Resumen detallado basado en evidencia encontrada",
  "recommendations": [
    "Recomendación específica 1",
    "Recomendación específica 2",
    "Recomendación específica 3"
  ],
  "key_moments": [
    {
      "timestamp": "MM:SS",
      "event": "Evento importante",
      "description": "Descripción del evento",
      "impact": "positive|negative|neutral"
    }
  ]
}
\`\`\`

**INSTRUCCIONES FINALES:**

1. Evalúa CADA tópico independientemente
2. USA la evidencia estructurada como fuente primaria
3. CITA los campos específicos en cada justificación
4. Si otorgas 0 puntos, explica QUÉ evidencia faltó
5. Si otorgas puntos completos, explica QUÉ evidencia lo sustenta
6. NO seas conservador si la evidencia existe
7. SÉ preciso y específico en cada evaluación`;
  }

  /**
   * MEJORADO: Reglas de matching más específicas
   */
  private getEnhancedMatchingRulesForTopic(topic: string, system: string): string {
    const rules: Record<string, string> = {
      'Cierre correcto del caso': `
BUSCAR EN:
- Transcripción: palabras clave ["bloqueé", "bloqueada", "reposición", "nueva tarjeta", "5 días", "sucursal"]
- Frases que indiquen pasos a seguir al cliente

CRITERIO:
✓ Si el agente menciona bloqueo Y pasos siguientes (reposición/sucursal) → PUNTOS COMPLETOS
✓ Si solo menciona una parte → PUNTOS PARCIALES
✗ Si no menciona el cierre → 0 puntos`,

      'Creación y llenado correcto del caso: (creación correcto del caso, selección de casillas, calificación de transacciones, comentarios correctos)': `
BUSCAR EN:
- FALCON: data.case_number (debe existir y tener formato válido)
- FALCON: data.checkboxes_checked (debe tener 3+ items)
- FALCON: data.transactions_marked = true
- FALCON: data.comment_text (debe tener contenido sustancial >20 chars)

CRITERIO:
✓ Si case_number existe Y checkboxes_checked tiene 3+ items Y transactions_marked = true Y comment_text tiene contenido → PUNTOS COMPLETOS
✓ Si faltan 1-2 elementos → PUNTOS PARCIALES
✗ Si falta case_number o todos están vacíos → 0 puntos`,

      'Codificación correcta del caso': `
BUSCAR EN:
- FRONT: data.case_code (debe contener "Fraude" o "Cerrado - Fraude")
- FRONT: data.case_type

CRITERIO:
✓ Si case_code contiene "Fraude" → PUNTOS COMPLETOS
✗ Si no existe o tiene otro valor → 0 puntos`,

      'Llenado correcto del front (caso correcto, comentarios acorde a la gestión, tienen afectación/ sin afectación)': `
BUSCAR EN (PRIORIDAD):
1. FRONT: data.comments_section (debe tener texto)
2. FRONT: data.has_afectacion (debe ser true o false, NO null)
3. FRONT: data.case_complete = true

BÚSQUEDA ALTERNATIVA (si NO hay FRONT):
4. FALCON: data.comment_text (comentarios del cliente >20 caracteres)
5. FALCON: data.case_number existe (implica que hay caso registrado)

CRITERIO FLEXIBLE:
✓ Si FRONT existe con comments_section Y has_afectacion válido → PUNTOS COMPLETOS (5)
✓ Si NO hay FRONT pero SÍ hay comment_text en FALCON >20 chars → PUNTOS COMPLETOS (5)
✓ Si solo hay comentarios parciales → PUNTOS PARCIALES (3)
✗ Si NO hay ningún comentario → 0 puntos

JUSTIFICACIÓN:
"Comentarios encontrados en [FRONT/FALCON]: [extracto]. Llenado considerado correcto."`,

      'Colocar capturas completas y correctas': `
BUSCAR EN:
- Contar sistemas diferentes con data estructurada
- Sistemas esperados: FALCON, VCAS, VISION, VRM, BI

CRITERIO:
✓ Si hay 4+ sistemas con data válida → PUNTOS COMPLETOS
✓ Si hay 3 sistemas → PUNTOS PARCIALES  
✗ Si hay menos de 3 → 0 puntos`,

      'Subir Excel': `
⚠️ REGLA CRÍTICA - NO CONFUNDIR SISTEMA CON ARCHIVO:

BUSCAR EN:
- OTRO: data.excel_visible = true
- OTRO: data.content_type = "EXCEL_FILE"
- OTRO: data.is_bi_system debe ser FALSE

⛔ NO ACEPTAR:
- Sistema BI con "Transacciones seleccionadas" (NO es Excel subido)
- Tablas dentro de interfaces del sistema
- Pantallas con logos Bradescard/VISA (es sistema)

✅ SÍ ACEPTAR:
- Captura de Microsoft Excel con columnas A, B, C
- Interfaz de Excel abierto
- Archivo Excel con datos de transacciones

CRITERIO ESTRICTO:
✓ Si excel_visible = true Y content_type = "EXCEL_FILE" Y is_bi_system = false → PUNTOS COMPLETOS (5)
✗ Si is_bi_system = true (aunque haya transacciones) → 0 puntos
✗ Si NO hay evidencia de archivo Excel real → 0 puntos

JUSTIFICACIÓN SI OTORGA PUNTOS:
"Excel subido visible: [nombre_archivo o descripción del archivo]"

JUSTIFICACIÓN SI NO OTORGA PUNTOS:
"Solo se observan pantallas del sistema BI. No hay evidencia de archivo Excel subido."`,

      'Bloquea tarjeta': `
BUSCAR EN:
- VCAS: data.account_status = "BLOCKED"
- VISION: data.block_types_marked contiene "BLKI"
- VISION: data.block_code existe
- Transcripción: menciones de "bloqueé", "bloqueada", "bloqueamos"

CRITERIO:
✓ Si account_status = BLOCKED O block_types_marked contiene BLKI O agente menciona bloqueo → PUNTOS COMPLETOS
✗ Si account_status = ACTIVE y no hay menciones → 0 puntos`,

      'Califica transacciones': `
BUSCAR EN:
- VCAS: data.transactions_marked = true
- FALCON: data.transactions_marked = true
- FALCON: data.transaction_count > 0

CRITERIO:
✓ Si transactions_marked = true en cualquier sistema → PUNTOS COMPLETOS
✗ Si no hay transacciones marcadas → 0 puntos`,

      'Comentarios correctos en ASHI': `
BUSCAR EN:
- VISION: data.ashi_comments (debe existir)
- VISION: data.ashi_detailed = true
- VISION: cualquier campo de comentarios con contenido

CRITERIO:
✓ Si ashi_comments existe con texto O ashi_detailed = true → PUNTOS COMPLETOS
✗ Si no hay comentarios → 0 puntos`,

      'Bloqueo correcto': `
BUSCAR EN:
- VISION: data.block_types_marked debe contener "BLKI"
- VISION: data.block_code = "F" (para fraude)
- VISION: data.block_date existe

CRITERIO:
✓ Si block_types_marked contiene "BLKI" → PUNTOS COMPLETOS
✗ Si no hay BLKI o está vacío → 0 puntos`,

      'Valida compras en ARTD y ARSD': `
BUSCAR EN:
- VRM: data.search_attempted = true
- VRM: data.account_searched existe
- VRM: cualquier indicador de validación

CRITERIO:
✓ Si search_attempted = true O account_searched tiene valor → PUNTOS COMPLETOS
✗ Si no hay evidencia de búsqueda en VRM → 0 puntos

NOTA: Si la imagen de VRM muestra "No se encontraron cuentas", esto CUENTA como validación intentada → PUNTOS COMPLETOS`,

      'Calificación de transacciones, comentarios y aplica mantenimiento': `
BUSCAR EN:
- VRM: data.maintenance_applied = true
- VRM: data.maintenance_code existe
- VRM: cualquier indicador de mantenimiento

CRITERIO:
✓ Si maintenance_applied = true O hay código de mantenimiento → PUNTOS COMPLETOS
✗ Si no hay evidencia de mantenimiento → 0 puntos`,

      'Crea el Folio Correctamente': `
BUSCAR EN:
- BI: data.folio_created = true
- BI: data.folio_number existe (formato: 10 dígitos)
- BI: critical_fields.has_folio_number = true
- BI: mensaje "Se ha creado el folio" visible

CRITERIO:
✓ Si folio_number existe con 10 dígitos Y (folio_created = true O mensaje visible) → PUNTOS COMPLETOS
✗ Si folio_number no existe o está vacío → 0 puntos`,

      'Cumple con el script': `
BUSCAR EN:
- Transcripción completa
- Elementos del script: saludo, validación/autenticación, explicación del proceso, preguntas de seguridad, información de pasos siguientes, despedida

CRITERIO:
✓ Si están presentes 5+ elementos del script → PUNTOS COMPLETOS (17 puntos)
✓ Si están presentes 3-4 elementos → PUNTOS PARCIALES (10-13 puntos)
✗ Si faltan elementos críticos o menos de 3 → PUNTOS BAJOS (0-8 puntos)`,

      'Autentica correctamente': `
BUSCAR EN TRANSCRIPCIÓN (primeros 3 minutos):

Métodos de autenticación válidos:
1. CallerID / Caller ID / Identificador de llamada
2. OTP / Código de verificación / Token / PIN
3. Preguntas de seguridad: "último cargo", "saldo", "movimientos recientes"
4. Validación verbal: "verifico identidad", "confirmó datos", "validé información"

Palabras clave EXACTAS:
- "callerid", "caller id"
- "otp", "código", "token", "clave"
- "verifico", "verificó", "valido", "validó"
- "confirmo", "confirmó", "corroboro", "corroboró"
- "último cargo", "saldo actual", "últimos movimientos"
- "preguntas de seguridad"

CRITERIO ESTRICTO:
✓ Si menciona CallerID → PUNTOS COMPLETOS (11)
✓ Si menciona OTP/código → PUNTOS COMPLETOS (11)
✓ Si hace preguntas de seguridad específicas (último cargo, saldo) → PUNTOS COMPLETOS (11)
✓ Si dice "verifico identidad" o "validó" explícitamente → PUNTOS COMPLETOS (11)
✗ Si NO hay NINGUNA mención de autenticación → 0 puntos

REGLA TEMPORAL:
- La autenticación debe estar en los PRIMEROS 2-3 minutos de llamada
- Si la autenticación es posterior, calificar como PARCIAL (6 puntos)

JUSTIFICACIÓN SI OTORGA PUNTOS:
"Autenticación realizada mediante [CallerID/OTP/Preguntas de seguridad]: [cita exacta de transcripción]"

JUSTIFICACIÓN SI NO OTORGA PUNTOS:
"No se encontró evidencia de autenticación al inicio de la llamada."`
    };

    return rules[topic] || `
BUSCAR EN:
- Sistema ${system}: Busca evidencia relevante en data estructurada
- Transcripción: Busca menciones relacionadas

CRITERIO:
✓ Si encuentras evidencia clara → PUNTOS COMPLETOS
✓ Si evidencia parcial → PUNTOS PARCIALES
✗ Si no hay evidencia → 0 puntos`;
  }

  private getSystemFromBlock(blockName: string): string {
    const mapping: Record<string, string> = {
      'Falcon': 'FALCON',
      'Front': 'FRONT',
      'Vcas': 'VCAS',
      'Vision': 'VISION',
      'VRM': 'VRM',
      'B.I': 'BI',
      'Manejo de llamada': 'TRANSCRIPCIÓN'
    };
    return mapping[blockName] || blockName;
  }

  private extractVerbalEvidence(transcript: TranscriptResult): string[] {
    const evidence: string[] = [];
    const keywords = [
      'bloque', 'bloqu', 'tarjeta',
      'folio', 'caso', 'número',
      'transacción', 'compra', 'cargo',
      'confirmo', 'confirmó', 'reconoce', 'reconozco',
      'fraude', 'fraudulent',
      'excel', 'archivo', 'documento',
      'autenticación', 'autentica', 'verifico', 'valido',
      'sistema', 'vcas', 'falcon', 'vision',
      'reposición', 'pasos a seguir', 'plástico',
      'sucursal', 'días', 'nueva',
      'callerid', 'caller id', 'identificador de llamada',
      'otp', 'código', 'clave', 'pin', 'token',
      'verificar', 'validar', 'corroborar',
      'identidad', 'identificación',
      'preguntas de seguridad',
      'último cargo', 'últimos movimientos', 'saldo',
      'código de seguridad'
    ];

    transcript.utterances.forEach(utt => {
      const lowerText = utt.text.toLowerCase();
      const hasKeyword = keywords.some(kw => lowerText.includes(kw));
      
      if (hasKeyword && utt.text.length > 15) {
        const timestamp = this.formatTime(utt.start);
        evidence.push(`[${timestamp}] ${utt.speaker}: "${utt.text}"`);
      }
    });

    return evidence;
  }

  private formatTranscript(transcript: TranscriptResult): string {
    if (transcript.utterances.length === 0) {
      return transcript.text;
    }

    return transcript.utterances
      .map((utt) => {
        const timestamp = this.formatTime(utt.start);
        return `[${timestamp}] ${utt.speaker}: ${utt.text}`;
      })
      .join('\n\n');
  }

  private formatTime(timeValue: number): string {
    const totalSeconds = timeValue >= 1000 ? Math.floor(timeValue / 1000) : timeValue;
    
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

export { EvaluatorService };

let instance: EvaluatorService | null = null;
export const getEvaluatorService = () => {
  if (!instance) {
    instance = new EvaluatorService();
  }
  return instance;
};

export const evaluatorService = {
  evaluate: async (auditInput: any, transcript: any, imageAnalyses: any) => {
    return getEvaluatorService().evaluate(auditInput, transcript, imageAnalyses);
  }
};