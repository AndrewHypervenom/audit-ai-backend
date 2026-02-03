import ExcelJS from 'exceljs';
import { logger } from '../utils/logger.js';
import type { AuditInput, EvaluationResult } from '../types/index.js';
import { getCriteriaForCallType, type EvaluationBlock } from '../config/evaluation-criteria.js';
import * as path from 'path';
import * as fs from 'fs';

class ExcelService {
  async generateExcelReport(
    auditInput: AuditInput,
    evaluation: Omit<EvaluationResult, 'excelUrl'>
  ): Promise<string> {
    try {
      logger.info('Generating Excel report with correct structure');

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Audit AI System';
      workbook.created = new Date();

      // Crear hoja "Analisis"
      const sheet = workbook.addWorksheet('Analisis');

      this.createAnalysisSheet(sheet, auditInput, evaluation);

      // Guardar archivo
      const resultsDir = process.env.RESULTS_DIR || './results';
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }

      const filename = `auditoria_${auditInput.executiveId}_${Date.now()}.xlsx`;
      const filepath = path.join(resultsDir, filename);

      await workbook.xlsx.writeFile(filepath);

      logger.success('Excel report generated', { filepath });

      return filename;
    } catch (error) {
      logger.error('Error generating Excel report', error);
      throw error;
    }
  }

  private createAnalysisSheet(
    sheet: ExcelJS.Worksheet,
    auditInput: AuditInput,
    evaluation: Omit<EvaluationResult, 'excelUrl'>
  ) {
    // Obtener criterios para el tipo de llamada
    const criteria = getCriteriaForCallType(auditInput.callType);

    // Crear mapa de evaluaciones por tópico
    const evaluationMap = new Map<string, any>();
    evaluation.detailedScores.forEach(score => {
      const match = score.criterion.match(/\[(.*?)\]\s*(.*)/);
      if (match) {
        const block = match[1];
        const topic = match[2];
        const key = `${block}|${topic}`;
        evaluationMap.set(key, score);
      }
    });

    // ============================================
    // FILA 1: ENCABEZADOS DE BLOQUES (merged cells)
    // ============================================
    
    const row1 = sheet.getRow(1);
    row1.height = 25;

    // Definir rangos de bloques EXACTOS según CSV
    const blockRanges = {
      'Falcon': { start: 12, end: 18 },
      'Front': { start: 19, end: 25 },
      'Vcas': { start: 26, end: 31 },
      'Vision': { start: 32, end: 35 },
      'VRM': { start: 36, end: 37 },
      'B.I': { start: 38, end: 38 },
      'Manejo de llamada': { start: 39, end: 42 }
    };

    // Crear encabezados de bloques en fila 1
    Object.entries(blockRanges).forEach(([blockName, range]) => {
      const startColLetter = this.getColumnLetter(range.start);
      const endColLetter = this.getColumnLetter(range.end);
      
      sheet.mergeCells(`${startColLetter}1:${endColLetter}1`);
      const cell = sheet.getCell(`${startColLetter}1`);
      cell.value = blockName;
      cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD92027' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = this.getAllBorders();
    });

    // ============================================
    // FILA 2: ENCABEZADOS DE COLUMNAS
    // ============================================

    const row2 = sheet.getRow(2);
    row2.height = 80;

    // Definir TODOS los encabezados en orden exacto
    const allHeaders = [
      'Bloques',                                                                                    // 1
      'Tópicos',                                                                                    // 2
      'Ponderación',                                                                                // 3
      'Folio',                                                                                      // 4
      'Nombre del Ejecutivo',                                                                       // 5
      'ID Ejecutivo',                                                                               // 6
      'Analista de Calidad',                                                                        // 7
      'Fecha de Llamada',                                                                           // 8
      'Fecha de Evaluación',                                                                        // 9
      'Duración de la llamada',                                                                     // 10
      'Tipo de llamada',                                                                            // 11
      'Cierre correcto del caso',                                                                   // 12
      'Creación y llenado correcto del caso: (creación correcto del caso, selección de casillas, calificación de transacciones, comentarios correctos)', // 13
      'Ingresa a HOTLIST_APROBAR / Ingresa a HOTLIST_Rechazar',                                   // 14
      'Ingresa a HOTLIST_APROBAR',                                                                 // 15
      'Ingresa a HOTLIST_Rechazar',                                                                // 16
      'Ingreso a HOTLIST_AVISO DE VIAJE',                                                          // 17
      'Califica correctamente la llamada',                                                          // 18
      'Codificación correcta del caso',                                                            // 19
      'Llenado correcto del front (caso correcto, comentarios acorde a la gestión)',              // 20
      'Llenado correcto del front (caso correcto, comentarios acorde a la gestión, tienen afectación/ sin afectación)', // 21
      'Sube capturas completas',                                                                   // 22
      'Colocar capturas completas y correctas',                                                    // 23
      'Subir Excel',                                                                               // 24
      'Califica correctamente la llamada',                                                          // 25
      'Calificación de transacciones',                                                             // 26
      'Aplica Bypass',                                                                             // 27
      'Bloquea tarjeta',                                                                           // 28
      'Califica transacciones',                                                                    // 29
      'Calificación de transacciones',                                                             // 30
      'Valida compras por facturar y cortes para identificar la compra para aclaración.\nValida que las compras no tengan una reversa', // 31
      'Valida pantalla OFAA y CRESP (CVV2 incorrecto, Tarjeta vencida, Fecha de vencimiento incorrecta, TJ Cancelada, etc)', // 32
      'Comentarios correctos en ASHI',                                                             // 33
      'Desbloquea tarjeta BLKI, BLKT, BPT0, BNFC',                                                // 34
      'Bloqueo correcto',                                                                          // 35
      'Valida compras en ARTD y ARSD',                                                             // 36
      'Calificación de transacciones, comentarios y aplica mantenimiento',                        // 37
      'Crea el Folio Correctamente',                                                              // 38
      'Cumple con el script',                                                                      // 39
      'Educación, frases de conexión, comunicación efectiva y escucha activa',                    // 40
      'Control de llamada y Puntualidad',                                                          // 41
      'Autentica correctamente',                                                                   // 42
      'Observaciones generales'                                                                    // 43
    ];

    // Aplicar encabezados
    allHeaders.forEach((header, idx) => {
      const cell = row2.getCell(idx + 1);
      cell.value = header;
      cell.font = { bold: true, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = this.getAllBorders();
    });

    // ============================================
    // FILA 3: PONDERACIÓN (Crítico o puntos)
    // ============================================

    const row3 = sheet.getRow(3);
    row3.height = 20;

    // Columnas 1-3: Bloques, Tópicos, Ponderación headers (vacías en fila 3)
    for (let i = 1; i <= 3; i++) {
      const cell = row3.getCell(i);
      cell.value = '';
      cell.border = this.getAllBorders();
    }

    // Columnas 4-11: Información general (vacías en fila 3)
    for (let i = 4; i <= 11; i++) {
      const cell = row3.getCell(i);
      cell.value = '';
      cell.border = this.getAllBorders();
    }

    // Columnas 12-42: Ponderación de cada tópico
    let colNum = 12;
    criteria.forEach(block => {
      block.topics.forEach(topic => {
        const cell = row3.getCell(colNum);
        
        if (!topic.applies) {
          cell.value = 'n/a';
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
          cell.font = { size: 9, color: { argb: 'FF666666' } };
        } else if (topic.criticality === 'Crítico') {
          cell.value = 'Crítico';
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
          cell.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        } else {
          cell.value = topic.points;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCCCCC' } };
          cell.font = { size: 9 };
        }
        
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = this.getAllBorders();
        colNum++;
      });
    });

    // Columna 43: Observaciones (vacía en fila 3)
    const obsHeaderCell = row3.getCell(43);
    obsHeaderCell.value = '';
    obsHeaderCell.border = this.getAllBorders();

    // ============================================
    // FILA 4: DATOS Y CALIFICACIONES
    // ============================================

    const row4 = sheet.getRow(4);
    row4.height = 25;

    // Columna 1: Bloques (merge vertical para todos los tópicos de cada bloque)
    let currentRow = 4;
    criteria.forEach(block => {
      const topicsCount = block.topics.length;
      if (topicsCount > 0) {
        // Solo merge si hay más de un tópico
        if (topicsCount > 1) {
          sheet.mergeCells(currentRow, 1, currentRow + topicsCount - 1, 1);
        }
        const cell = sheet.getCell(currentRow, 1);
        cell.value = block.blockName;
        cell.font = { bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = this.getAllBorders();
        currentRow += topicsCount;
      }
    });

    // Columna 2: Tópicos (una fila por cada tópico)
    currentRow = 4;
    criteria.forEach(block => {
      block.topics.forEach(topic => {
        const cell = sheet.getCell(currentRow, 2);
        cell.value = topic.topic;
        cell.font = { size: 9 };
        cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        cell.border = this.getAllBorders();
        currentRow++;
      });
    });

    // Columna 3: Ponderación de cada tópico
    currentRow = 4;
    criteria.forEach(block => {
      block.topics.forEach(topic => {
        const cell = sheet.getCell(currentRow, 3);
        
        if (!topic.applies) {
          cell.value = 'n/a';
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
          cell.font = { size: 9, color: { argb: 'FF666666' } };
        } else if (topic.criticality === 'Crítico') {
          cell.value = 'Crítico';
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
          cell.font = { size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        } else {
          cell.value = topic.points;
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCCCCC' } };
          cell.font = { size: 9 };
        }
        
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = this.getAllBorders();
        currentRow++;
      });
    });

    // Columnas 4-11: Información general (solo en la primera fila de datos)
    const infoCell4 = row4.getCell(4);
    infoCell4.value = '';
    infoCell4.alignment = { horizontal: 'center', vertical: 'middle' };
    infoCell4.border = this.getAllBorders();

    const infoCell5 = row4.getCell(5);
    infoCell5.value = auditInput.executiveName;
    infoCell5.alignment = { horizontal: 'left', vertical: 'middle' };
    infoCell5.border = this.getAllBorders();

    const infoCell6 = row4.getCell(6);
    infoCell6.value = auditInput.executiveId;
    infoCell6.alignment = { horizontal: 'center', vertical: 'middle' };
    infoCell6.border = this.getAllBorders();

    const infoCell7 = row4.getCell(7);
    infoCell7.value = 'IA';
    infoCell7.alignment = { horizontal: 'left', vertical: 'middle' };
    infoCell7.border = this.getAllBorders();

    const infoCell8 = row4.getCell(8);
    infoCell8.value = auditInput.callDate;
    infoCell8.alignment = { horizontal: 'center', vertical: 'middle' };
    infoCell8.border = this.getAllBorders();

    const infoCell9 = row4.getCell(9);
    infoCell9.value = new Date().toLocaleDateString('es-MX');
    infoCell9.alignment = { horizontal: 'center', vertical: 'middle' };
    infoCell9.border = this.getAllBorders();

    const infoCell10 = row4.getCell(10);
    infoCell10.value = this.formatDuration(auditInput.callDuration ?? undefined);
    infoCell10.alignment = { horizontal: 'center', vertical: 'middle' };
    infoCell10.border = this.getAllBorders();

    const infoCell11 = row4.getCell(11);
    infoCell11.value = auditInput.callType;
    infoCell11.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    infoCell11.border = this.getAllBorders();

    // Función helper para obtener valor con razón clara
    const getTopicValueWithReason = (blockName: string, topicName: string, topic: any) => {
      if (!topic.applies) {
        return { value: 'n/a', reason: 'No aplica para este tipo de llamada', shouldHighlight: false };
      }

      const key = `${blockName}|${topicName}`;
      const score = evaluationMap.get(key);

      if (!score) {
        // Si no hay calificación de la IA
        return { 
          value: 'Sin evaluar', 
          reason: 'No se encontró evidencia suficiente en transcripción ni en capturas para evaluar este criterio', 
          shouldHighlight: false 
        };
      }

      if (score.score === 0) {
        // Si la IA calificó con 0
        return { 
          value: 0, 
          reason: score.justification || 'No cumplió con el criterio', 
          shouldHighlight: true 
        };
      }

      // Si la IA calificó positivamente
      return { 
        value: score.score, 
        reason: score.justification || 'Cumplió correctamente', 
        shouldHighlight: true 
      };
    };

    // Columnas 12-42: Calificaciones de cada tópico
    colNum = 12;
    criteria.forEach(block => {
      block.topics.forEach(topic => {
        const cell = row4.getCell(colNum);
        const result = getTopicValueWithReason(block.blockName, topic.topic, topic);
        
        cell.value = result.value;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = this.getAllBorders();

        if (result.shouldHighlight) {
          // Celda negra con texto blanco para items calificados
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
          cell.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          
          // Agregar comentario con la razón
          cell.note = {
            texts: [
              {
                font: { size: 10, name: 'Calibri' },
                text: result.reason
              }
            ],
            margins: {
              insetmode: 'custom',
              inset: [0.1, 0.1, 0.1, 0.1]
            }
          };
        } else if (result.value === 'n/a') {
          // Celda gris claro para n/a
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
          cell.font = { size: 10, color: { argb: 'FF666666' } };
        } else {
          // Celda blanca con gris para "Sin evaluar"
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
          cell.font = { size: 9, italic: true, color: { argb: 'FF666666' } };
          
          // Agregar comentario explicando por qué no se evaluó
          cell.note = {
            texts: [
              {
                font: { size: 10, name: 'Calibri' },
                text: result.reason
              }
            ],
            margins: {
              insetmode: 'custom',
              inset: [0.1, 0.1, 0.1, 0.1]
            }
          };
        }
        
        colNum++;
      });
    });

    // Columna 43: Observaciones
    const obsCell = row4.getCell(43);
    
    // Agregar momentos clave formateados en las observaciones
    let observationsText = evaluation.observations;
    
    if (evaluation.keyMoments && evaluation.keyMoments.length > 0) {
      observationsText += '\n\nMomentos clave de la llamada:\n';
      evaluation.keyMoments.forEach(moment => {
        const formattedTimestamp = this.formatTimestamp(moment.timestamp);
        observationsText += `[${formattedTimestamp}] ${moment.type}: ${moment.description}\n`;
      });
    }
    
    obsCell.value = observationsText;
    obsCell.font = { size: 9 };
    obsCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    obsCell.border = this.getAllBorders();

    // ============================================
    // AJUSTAR ANCHOS DE COLUMNAS
    // ============================================

    sheet.getColumn(1).width = 15;  // Bloques
    sheet.getColumn(2).width = 40;  // Tópicos
    sheet.getColumn(3).width = 12;  // Ponderación
    sheet.getColumn(4).width = 8;   // Folio
    sheet.getColumn(5).width = 30;  // Nombre
    sheet.getColumn(6).width = 12;  // ID
    sheet.getColumn(7).width = 25;  // Analista
    sheet.getColumn(8).width = 18;  // Fecha llamada
    sheet.getColumn(9).width = 18;  // Fecha evaluación
    sheet.getColumn(10).width = 12; // Duración
    sheet.getColumn(11).width = 40; // Tipo

    // Columnas 12-42: tópicos (ancho estándar)
    for (let i = 12; i <= 42; i++) {
      sheet.getColumn(i).width = 15;
    }

    // Columna 43: Observaciones (más ancha)
    sheet.getColumn(43).width = 50;
  }

  /**
   * Convierte duración de "HH:MM:SS" o "MM:SS" a formato "MM:SS"
   */
  private formatDuration(duration?: string): string {
    if (!duration) return 'N/A';
    
    const parts = duration.split(':');
    
    if (parts.length === 3) {
      // Formato HH:MM:SS -> convertir a MM:SS
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseInt(parts[2]) || 0;
      
      const totalMinutes = hours * 60 + minutes;
      return `${totalMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else if (parts.length === 2) {
      // Ya está en formato MM:SS
      return duration;
    }
    
    return duration;
  }

  /**
   * Formatea un timestamp a formato MM:SS
   * Acepta formatos: "00:01:30", "1:30", "90" (segundos)
   */
  private formatTimestamp(timestamp: string): string {
    if (!timestamp) return '00:00';
    
    // Si ya está en formato MM:SS, devolverlo
    if (/^\d{2}:\d{2}$/.test(timestamp)) {
      return timestamp;
    }
    
    // Si está en formato HH:MM:SS
    if (/^\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
      const parts = timestamp.split(':');
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseInt(parts[2]) || 0;
      
      const totalMinutes = hours * 60 + minutes;
      return `${totalMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    // Si es solo un número (segundos)
    const totalSeconds = parseInt(timestamp);
    if (!isNaN(totalSeconds)) {
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    return timestamp;
  }

  private getColumnLetter(colNumber: number): string {
    let letter = '';
    let temp = colNumber;
    
    while (temp > 0) {
      const remainder = (temp - 1) % 26;
      letter = String.fromCharCode(65 + remainder) + letter;
      temp = Math.floor((temp - 1) / 26);
    }
    
    return letter;
  }

  private getAllBorders() {
    return {
      top: { style: 'thin' as const, color: { argb: 'FF000000' } },
      left: { style: 'thin' as const, color: { argb: 'FF000000' } },
      bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
      right: { style: 'thin' as const, color: { argb: 'FF000000' } }
    };
  }
}

export { ExcelService };

let instance: ExcelService | null = null;
export const getExcelService = () => {
  if (!instance) {
    instance = new ExcelService();
  }
  return instance;
};

export const excelService = {
  generateExcelReport: async (auditInput: any, evaluation: any) => {
    return getExcelService().generateExcelReport(auditInput, evaluation);
  }
};