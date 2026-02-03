//backend/src/services/openai.service.ts

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import type { ImageAnalysis } from '../types/index.js';
import * as fs from 'fs';

class OpenAIService {
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    this.client = new OpenAI({ apiKey });
  }

  async analyzeImage(imagePath: string): Promise<ImageAnalysis & { usage?: { input_tokens: number; output_tokens: number } }> {
    try {
      logger.info('Analyzing image with ENHANCED detection', { imagePath });

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
                text: this.getEnhancedImageAnalysisPrompt()
              }
            ]
          }
        ]
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      // Limpieza robusta del JSON
      let cleanedContent = content.trim();
      cleanedContent = cleanedContent.replace(/```json\n?/gi, '');
      cleanedContent = cleanedContent.replace(/```\n?/g, '');
      cleanedContent = cleanedContent.replace(/^\uFEFF/, '');
      cleanedContent = cleanedContent.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\');
      
      const parsed = JSON.parse(cleanedContent);
      
      logger.success('Image analyzed with enhanced detection', {
        system: parsed.system,
        confidence: parsed.confidence,
        criticalFieldsFound: Object.keys(parsed.critical_fields || {}).length,
        totalFieldsFound: Object.keys(parsed.data || {}).length,
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0
      });

      return {
        imagePath,
        system: parsed.system,
        data: {
          ...parsed.data,
          critical_fields: parsed.critical_fields
        },
        confidence: parsed.confidence,
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0
        }
      };

    } catch (error) {
      logger.error('Error analyzing image', error);
      throw error;
    }
  }

  private getEnhancedImageAnalysisPrompt(): string {
    return `Analiza esta captura de pantalla de sistema bancario con MÁXIMA PRECISIÓN y EXTRAE TODOS LOS DATOS VISIBLES.

**OBJETIVO:** Lee cada línea de texto visible y extrae TODOS los datos relevantes.

**PASO 1: IDENTIFICA EL SISTEMA**

Observa la interfaz y determina qué sistema es:

- **FALCON**: Sistema de casos de fraude
  * Tiene secciones como "Número de caso", "Investigación", "Transacciones"
  * Muestra checkboxes (Cliente contactado, Reporte de fraude, SMS, etc.)
  * Tabla con transacciones marcadas (CNF, etc.)
  * Comentarios del cliente
  
- **VCAS**: Sistema de tarjetas VISA
  * Título "Account Activity Overview"
  * Muestra "Status: BLOCKED" o similar
  * "Account State History" con historial de bloqueos
  * Bypass: ON/OFF
  
- **VISION**: Sistema IBI SERVICES / ARQE
  * Pantalla con texto verde sobre negro
  * Muestra códigos como BLKT, BLKI, BNFC, BPT0
  * BLOCK CODE con fecha
  * POST TO ACCOUNT NUMBER
  
- **VRM**: Visa Risk Manager
  * Interfaz de búsqueda de cuentas
  * "No se encontraron cuentas que coincidan con sus criterios"
  * Campos de búsqueda (Número de cuenta, datos del comercio)
  
- **BI**: Business Intelligence / Alta de tickets
  * Mensaje "Se ha creado el folio XXXXXXXXXX exitosamente"
  * Sección "Transacciones seleccionadas"
  * Muestra folios y transacciones con estados (Abierto, Cerrado)
  
- **FRONT**: Sistema de registro/codificación de casos
  * Codificación de casos (ej: "Cerrado - Fraude")
  * Comentarios de gestión
  * Indica "con afectación" / "sin afectación"
  
- **OTRO**: Excel, listas de transacciones, documentos
  * Tablas con columnas de fecha, comercio, monto
  * Listas de transacciones
  * Archivos adjuntos

**PASO 2: EXTRAE TODOS LOS CAMPOS SEGÚN EL SISTEMA**

Lee CADA LÍNEA visible. No omitas nada. Para cada sistema:

# SI ES FALCON:
Extrae TODOS estos campos si están visibles:

\`\`\`json
{
  "case_number": "número completo del caso",
  "case_status": "Cerrado/Abierto/En proceso",
  "service_type": "tipo de servicio visible",
  "store_city": "ciudad de la tienda",
  "fraud_type": "tipo de fraude seleccionado en dropdown",
  "checkboxes_checked": ["lista", "de", "checkboxes", "marcados"],
  "transactions_marked": true/false,
  "transaction_count": número_de_transacciones,
  "transaction_table_visible": true/false,
  "comment_text": "texto completo del comentario del cliente",
  "comments_present": true/false,
  "investigation_type": "tipo de investigación seleccionado",
  "fraud_score": "puntaje si visible"
}
\`\`\`

# SI ES VCAS:
\`\`\`json
{
  "account_number": "número de cuenta de 16 dígitos",
  "account_status": "BLOCKED/ACTIVE/etc",
  "block_date": "fecha exacta de bloqueo YYYY/MM/DD HH:MM:SS",
  "block_user": "usuario que bloqueó",
  "bypass_status": "ON/OFF",
  "account_history_visible": true/false,
  "unblock_option_visible": true/false
}
\`\`\`

# SI ES VISION:
\`\`\`json
{
  "account_number": "cuenta visible",
  "block_code": "código de bloqueo (ej: F)",
  "block_date": "fecha del bloqueo",
  "block_types_marked": ["BLKT", "BLKI", "BNFC"],
  "cnrr_crd_date": "fecha de tarjeta actual",
  "card_activation_date": "fecha de activación",
  "warn_codes": "códigos de advertencia visibles"
}
\`\`\`

# SI ES BI:
\`\`\`json
{
  "folio_created": true/false,
  "folio_number": "número completo del folio (10 dígitos)",
  "success_message": "texto del mensaje de éxito",
  "transactions_selected": true/false,
  "transaction_count": número_de_transacciones,
  "transaction_status": "Abierto/Cerrado",
  "transaction_details": ["lista de transacciones si visible"]
}
\`\`\`

# SI ES VRM:
\`\`\`json
{
  "search_attempted": true/false,
  "account_searched": "número de cuenta buscado",
  "no_results_message": true/false,
  "search_criteria": "cuenta/comercio",
  "search_type": "tipo de búsqueda seleccionado"
}
\`\`\`

# SI ES OTRO (Excel/Transacciones/Documentos):

⚠️ CRÍTICO - DIFERENCIA ENTRE SISTEMA Y ARCHIVO:

**NO es un Excel subido:**
- Pantallas que dicen "Transacciones seleccionadas" → Sistema BI
- Tablas dentro de la interfaz del sistema → Sistema interno  
- Cualquier cosa con logo Bradescard/VISA/sistema → Sistema
- Botones de navegación del sistema → Sistema

**SÍ es un Excel subido:**
- Interfaz de Microsoft Excel (con columnas A, B, C, D)
- Barra de herramientas de Excel visible
- Archivo Excel abierto fuera del sistema
- Nombre de archivo .xlsx visible

Extrae:
\`\`\`json
{
  "content_type": "BI_SYSTEM | EXCEL_FILE | PDF | OTHER",
  "excel_visible": false,  // ⚠️ Solo true si es ARCHIVO Excel real
  "is_bi_system": true/false,  // true si es pantalla de sistema BI
  "transaction_list_visible": true/false,
  "transaction_count": número_de_filas,
  "merchants_visible": ["comercio1", "comercio2"],
  "amounts_visible": ["$20", "$400"],
  "dates_visible": ["14/10/2025"],
  "excel_has_data": false  // Solo true si es archivo Excel
}
\`\`\`

**REGLA ESTRICTA:**
- Si ves interfaz del sistema BI → content_type = "BI_SYSTEM", excel_visible = false
- Si ves interfaz de Excel → content_type = "EXCEL_FILE", excel_visible = true
- Cuando hay duda → excel_visible = false (ser conservador)

**PASO 3: MARCA CAMPOS CRÍTICOS**

Identifica qué campos críticos están presentes:

\`\`\`json
"critical_fields": {
  "has_case_number": true si hay número de caso,
  "has_blocked_status": true si la tarjeta está bloqueada,
  "has_folio_number": true si hay número de folio,
  "has_transactions": true si hay transacciones visibles,
  "has_fraud_checkboxes": true si hay checkboxes marcados,
  "has_block_codes": true si hay códigos BLKI/BLKT/BNFC,
  "has_comments": true si hay comentarios visibles,
  "has_transaction_table": true si hay tabla de transacciones
}
\`\`\`

**PASO 4: GENERA FINDINGS ESPECÍFICOS**

Para cada campo encontrado, crea un finding que cite EXACTAMENTE dónde lo viste:

Ejemplos de BUENOS findings:
✓ "case_number: 6788724 - Visible en campo 'Número de caso' en la parte superior izquierda"
✓ "checkboxes_checked: 4 items ['Cliente contactado', 'Reporte de fraude', 'SMS', 'Eliminar bloqueo'] - Marcados en sección Investigación"
✓ "account_status: BLOCKED - Visible en 'Status: BLOCKED' de color rojo"
✓ "folio_number: 2540493912 - Visible en mensaje 'Se ha creado el folio 2540493912 exitosamente'"
✓ "block_types_marked: ['BLKI', 'BNFC'] - Marcados con 'Y' en la pantalla VISION"

Ejemplos de MALOS findings:
✗ "Hay un caso" (muy vago)
✗ "La tarjeta parece bloqueada" (no es específico)
✗ "Se ve información" (no dice qué información)

**FORMATO DE RESPUESTA JSON:**

\`\`\`json
{
  "system": "FALCON|VCAS|VISION|VRM|BI|FRONT|OTRO",
  "confidence": 0.95,
  "data": {
    "campo1": "valor_exacto",
    "campo2": true,
    "campo3": ["lista", "de", "valores"],
    "campo4": 123
  },
  "critical_fields": {
    "has_case_number": true,
    "has_blocked_status": false,
    "has_folio_number": true,
    "has_transactions": true
  },
  "findings": [
    "campo1: valor - Ubicación exacta en la imagen",
    "campo2: true - Explicación de qué se vio",
    "campo3: [lista] - Dónde están estos valores"
  ]
}
\`\`\`

**REGLAS CRÍTICAS:**

1. **Lee TODO el texto visible** - No omitas ni una sola línea
2. **Si ves un número, cópialo EXACTAMENTE** - No lo resumas
3. **Si ves checkboxes marcados, LISTA TODOS** - No digas "varios"
4. **Si ves transacciones, CUENTA cuántas** - No digas "varias"
5. **Si ves códigos de bloqueo, REPÓRTALOS TODOS** - No solo uno
6. **NO inventes valores** - Si no está visible, usa null
7. **SÉ ULTRA específico** - Cita ubicaciones exactas

Ahora analiza la imagen proporcionada siguiendo TODOS estos pasos y reglas.`;
  }

  async analyzeMultipleImages(imagePaths: string[]): Promise<Array<ImageAnalysis & { usage?: { input_tokens: number; output_tokens: number } }>> {
    const analyses: Array<ImageAnalysis & { usage?: { input_tokens: number; output_tokens: number } }> = [];

    for (const imagePath of imagePaths) {
      try {
        const analysis = await this.analyzeImage(imagePath);
        analyses.push(analysis);
      } catch (error) {
        logger.error(`Failed to analyze ${imagePath}`, error);
      }
    }

    return analyses;
  }
}

export { OpenAIService };

let instance: OpenAIService | null = null;
export const getOpenAIService = () => {
  if (!instance) {
    instance = new OpenAIService();
  }
  return instance;
};

export const openAIService = {
  analyzeImage: async (imagePath: string) => {
    return getOpenAIService().analyzeImage(imagePath);
  },
  analyzeMultipleImages: async (imagePaths: string[]) => {
    return getOpenAIService().analyzeMultipleImages(imagePaths);
  }
};