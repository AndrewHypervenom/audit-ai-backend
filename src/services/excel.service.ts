import ExcelJS from 'exceljs';
import { logger } from '../utils/logger.js';
import type { AuditInput, EvaluationResult } from '../types/index.js';
import { getCriteriaForCallType, type EvaluationBlock } from '../config/evaluation-criteria.js';
import * as path from 'path';
import * as fs from 'fs';

class ExcelService {
  // ✅ NUEVO: Helper para limpiar nombres de archivos
  private sanitizeFilename(text: string): string {
    return text
      .replace(/\s+/g, '_')  // Reemplazar espacios con _
      .replace(/\t/g, '_')   // Reemplazar tabs con _
      .replace(/[^\w\-_.]/g, '') // Remover caracteres especiales
      .substring(0, 100);    // Limitar longitud
  }

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

      // ✅ CAMBIO: Limpiar el executiveId antes de usarlo en el nombre
      const cleanExecutiveId = this.sanitizeFilename(auditInput.executiveId);
      const filename = `auditoria_${cleanExecutiveId}_${Date.now()}.xlsx`;
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
      'Bloques',
      'Tópicos',
      'Ponderación',
      'Folio',
      'Nombre del Ejecutivo',
      'ID Ejecutivo',
      'Analista de Calidad',
      'Fecha de Llamada',
      'Fecha de Evaluación',
      'Duración de la llamada',
      'Tipo de llamada',
      'Cierre correcto del caso',
      'Creación y llenado correcto del caso: (creación correcto del caso, selección de casillas, calificación de transacciones, comentarios correctos)',
      'Ingresa a HOTLIST_APROBAR / Ingresa a HOTLIST_Rechazar',
      'Ingresa a HOTLIST_APROBAR',
      'Ingresa a HOTLIST_Rechazar',
      'Ingreso a HOTLIST_AVISO DE VIAJE',
      'Califica correctamente la llamada',
      'Codificación correcta del caso',
      'Llenado correcto del front (caso correcto, comentarios acorde a la gestión)',
      'Llenado correcto del front (caso correcto, comentarios acorde a la gestión, tienen afectación/ sin afectación)',
      'Sube capturas completas',
      'Colocar capturas completas y correctas',
      'Subir Excel',
      'Califica correctamente la llamada',
      'Calificación de transacciones',
      'Aplica Bypass',
      'Bloquea tarjeta',
      'Califica transacciones',
      'Calificación de transacciones',
      'Valida compras por facturar y cortes para identificar la compra para aclaración.\nValida que las compras no tengan una reversa',
      'Valida pantalla OFAA y CRESP (CVV2 incorrecto, Tarjeta vencida, Fecha de vencimiento incorrecta, TJ Cancelada, etc)',
      'Comentarios correctos en ASHI',
      'Desbloquea tarjeta BLKI, BLKT, BPT0, BNFC',
      'Bloqueo correcto',
      'Valida compras en ARTD y ARSD',
      'Calificación de transacciones, comentarios y aplica mantenimiento',
      'Crea el Folio Correctamente',
      'Cumple con el script',
      'Educación, frases de conexión, comunicación efectiva y escucha activa',
      'Control de llamada y Puntualidad',
      'Autentica correctamente',
      'Observaciones generales'
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
        } else if (topic.criticality === 'Crítico') {  // ✅ CORREGIDO: era 'CrÃ­tico'
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
        } else if (topic.criticality === 'Crítico') {  // ✅ CORREGIDO: era 'CrÃ­tico'
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
        return { 
          value: 'Sin evaluar', 
          reason: 'No se encontró evidencia suficiente en transcripción ni en capturas para evaluar este criterio', 
          shouldHighlight: false 
        };
      }

      if (score.score === 0) {
        return { 
          value: 0, 
          reason: score.justification || 'No cumplió con el criterio', 
          shouldHighlight: true 
        };
      }

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
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
          cell.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          
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
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
          cell.font = { size: 10, color: { argb: 'FF666666' } };
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
          cell.font = { size: 9, italic: true, color: { argb: 'FF666666' } };
          
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

    sheet.getColumn(1).width = 15;
    sheet.getColumn(2).width = 40;
    sheet.getColumn(3).width = 12;
    sheet.getColumn(4).width = 8;
    sheet.getColumn(5).width = 30;
    sheet.getColumn(6).width = 12;
    sheet.getColumn(7).width = 25;
    sheet.getColumn(8).width = 18;
    sheet.getColumn(9).width = 18;
    sheet.getColumn(10).width = 12;
    sheet.getColumn(11).width = 40;

    for (let i = 12; i <= 42; i++) {
      sheet.getColumn(i).width = 15;
    }

    sheet.getColumn(43).width = 50;
  }

  private formatDuration(duration?: string): string {
    if (!duration) return 'N/A';
    
    const parts = duration.split(':');
    
    if (parts.length === 3) {
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseInt(parts[2]) || 0;
      
      const totalMinutes = hours * 60 + minutes;
      return `${totalMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else if (parts.length === 2) {
      return duration;
    }
    
    return duration;
  }

  private formatTimestamp(timestamp: string): string {
    if (!timestamp) return '00:00';
    
    if (/^\d{2}:\d{2}$/.test(timestamp)) {
      return timestamp;
    }
    
    if (/^\d{2}:\d{2}:\d{2}$/.test(timestamp)) {
      const parts = timestamp.split(':');
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseInt(parts[2]) || 0;
      
      const totalMinutes = hours * 60 + minutes;
      return `${totalMinutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
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