//backend/src/config/evaluation-criteria.ts

export interface EvaluationTopic {
  topic: string;
  criticality: 'Crítico' | '-';
  points: number | 'n/a';
  applies: boolean;
  whatToLookFor?: string;
}

export interface EvaluationBlock {
  blockName: string;
  topics: EvaluationTopic[];
}

export const FRAUD_CRITERIA: EvaluationBlock[] = [
  {
    blockName: 'Falcon',
    topics: [
      { 
        topic: 'Cierre correcto del caso', 
        criticality: 'Crítico', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En transcripción: agente cierra adecuadamente el caso informando pasos siguientes al cliente'
      },
      { 
        topic: 'Creación y llenado correcto del caso: (creación correcto del caso, selección de casillas, calificación de transacciones, comentarios correctos)', 
        criticality: '-', 
        points: 10, 
        applies: true,
        whatToLookFor: 'En capturas FALCON: caso creado correctamente, casillas marcadas, transacciones calificadas, comentarios completos'
      },
      { 
        topic: 'Ingresa a HOTLIST_APROBAR / Ingresa a HOTLIST_Rechazar', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para FRAUDE'
      },
      { 
        topic: 'Ingresa a HOTLIST_APROBAR', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para FRAUDE'
      },
      { 
        topic: 'Ingresa a HOTLIST_Rechazar', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para FRAUDE'
      },
      { 
        topic: 'Ingreso a HOTLIST_AVISO DE VIAJE', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para FRAUDE'
      },
      { 
        topic: 'Califica correctamente la llamada', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para FRAUDE'
      }
    ]
  },
  {
    blockName: 'Front',
    topics: [
      { 
        topic: 'Codificación correcta del caso', 
        criticality: 'Crítico', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En capturas FRONT: caso codificado correctamente con el código apropiado para fraude'
      },
      { 
        topic: 'Llenado correcto del front (caso correcto, comentarios acorde a la gestión)', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para FRAUDE (se usa otra versión del tópico)'
      },
      { 
        topic: 'Llenado correcto del front (caso correcto, comentarios acorde a la gestión, tienen afectación/ sin afectación)', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En capturas FRONT: comentarios detallados con indicación clara de si hay afectación o no'
      },
      { 
        topic: 'Sube capturas completas', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica directamente'
      },
      { 
        topic: 'Colocar capturas completas y correctas', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'Verificar que existen capturas de FALCON, VCAS, VISION, VRM, BI - todas completas y legibles'
      },
      { 
        topic: 'Subir Excel', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En capturas o transcripción: evidencia de Excel con movimientos subido al sistema'
      },
      { 
        topic: 'Califica correctamente la llamada', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica en esta sección para FRAUDE'
      }
    ]
  },
  {
    blockName: 'Vcas',
    topics: [
      { 
        topic: 'Calificación de transacciones', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica (se usa "Califica transacciones")'
      },
      { 
        topic: 'Aplica Bypass', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para FRAUDE'
      },
      { 
        topic: 'Bloquea tarjeta', 
        criticality: 'Crítico', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En transcripción: agente menciona bloqueo de tarjeta. En capturas VCAS: status BLKI o bloqueo aplicado'
      },
      { 
        topic: 'Califica transacciones', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En capturas VCAS: transacciones marcadas correctamente como fraude o legítimas según corresponda'
      },
      { 
        topic: 'Calificación de transacciones', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'Duplicado, no aplica'
      },
      { 
        topic: 'Valida compras por facturar y cortes para identificar la compra para aclaración.\nValida que las compras no tengan una reversa', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para FRAUDE'
      }
    ]
  },
  {
    blockName: 'Vision',
    topics: [
      { 
        topic: 'Valida pantalla OFAA y CRESP (CVV2 incorrecto, Tarjeta vencida, Fecha de vencimiento incorrecta, TJ Cancelada, etc)', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para FRAUDE'
      },
      { 
        topic: 'Comentarios correctos en ASHI', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En capturas VISION/ASHI: comentarios claros y completos sobre la gestión realizada'
      },
      { 
        topic: 'Desbloquea tarjeta BLKI, BLKT, BPT0, BNFC', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para FRAUDE (en fraude se BLOQUEA, no se desbloquea)'
      },
      { 
        topic: 'Bloqueo correcto', 
        criticality: 'Crítico', 
        points: 7, 
        applies: true,
        whatToLookFor: 'En capturas VISION: tipo de bloqueo correcto aplicado (BLKI para fraude)'
      }
    ]
  },
  {
    blockName: 'VRM',
    topics: [
      { 
        topic: 'Valida compras en ARTD y ARSD', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En capturas VRM: transacciones validadas en pantallas ARTD y ARSD'
      },
      { 
        topic: 'Calificación de transacciones, comentarios y aplica mantenimiento', 
        criticality: 'Crítico', 
        points: 10, 
        applies: true,
        whatToLookFor: 'En VRM: transacciones calificadas correctamente, comentarios agregados, y mantenimiento aplicado'
      }
    ]
  },
  {
    blockName: 'B.I',
    topics: [
      { 
        topic: 'Crea el Folio Correctamente', 
        criticality: '-', 
        points: 10, 
        applies: true,
        whatToLookFor: 'En capturas BI: folio creado con todos los datos completos y correctos'
      }
    ]
  },
  {
    blockName: 'Manejo de llamada',
    topics: [
      { 
        topic: 'Cumple con el script', 
        criticality: '-', 
        points: 17, 
        applies: true,
        whatToLookFor: 'En transcripción: sigue el script completo (saludo, validación, explicación del proceso, preguntas de seguridad, cierre)'
      },
      { 
        topic: 'Educación, frases de conexión, comunicación efectiva y escucha activa', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En transcripción: usa frases de empatía, responde adecuadamente a las inquietudes del cliente, escucha activamente'
      },
      { 
        topic: 'Control de llamada y Puntualidad', 
        criticality: '-', 
        points: 6, 
        applies: true,
        whatToLookFor: 'En transcripción: mantiene control de la conversación, no se desvía del tema, maneja objeciones adecuadamente'
      },
      { 
        topic: 'Autentica correctamente', 
        criticality: '-', 
        points: 11, 
        applies: true,
        whatToLookFor: 'En transcripción: realiza autenticación completa al inicio de la llamada (CallerID, OTP, o preguntas de seguridad según protocolo)'
      }
    ]
  }
];

export const TH_CONFIRMA_CRITERIA: EvaluationBlock[] = [
  {
    blockName: 'Falcon',
    topics: [
      { 
        topic: 'Cierre correcto del caso', 
        criticality: 'Crítico', 
        points: 5, 
        applies: true,
        whatToLookFor: 'Cierre adecuado del caso'
      },
      { 
        topic: 'Creación y llenado correcto del caso: (creación correcto del caso, selección de casillas, calificación de transacciones, comentarios correctos)', 
        criticality: '-', 
        points: 10, 
        applies: true,
        whatToLookFor: 'Caso creado correctamente en Falcon'
      },
      { 
        topic: 'Ingresa a HOTLIST_APROBAR / Ingresa a HOTLIST_Rechazar', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica'
      },
      { 
        topic: 'Ingresa a HOTLIST_APROBAR', 
        criticality: '-', 
        points: 12, 
        applies: true,
        whatToLookFor: 'En capturas Falcon: ingresó a HOTLIST para aprobar'
      },
      { 
        topic: 'Ingresa a HOTLIST_Rechazar', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica si aprobó'
      },
      { 
        topic: 'Ingreso a HOTLIST_AVISO DE VIAJE', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica'
      },
      { 
        topic: 'Califica correctamente la llamada', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica'
      }
    ]
  },
  {
    blockName: 'Front',
    topics: [
      { 
        topic: 'Codificación correcta del caso', 
        criticality: 'Crítico', 
        points: 5, 
        applies: true,
        whatToLookFor: 'Codificación correcta en FRONT'
      },
      { 
        topic: 'Llenado correcto del front (caso correcto, comentarios acorde a la gestión)', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'FRONT con comentarios completos'
      },
      { 
        topic: 'Llenado correcto del front (caso correcto, comentarios acorde a la gestión, tienen afectación/ sin afectación)', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica'
      },
      { 
        topic: 'Sube capturas completas', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica'
      },
      { 
        topic: 'Colocar capturas completas y correctas', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'Capturas necesarias'
      },
      { 
        topic: 'Subir Excel', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'Excel con movimientos'
      },
      { 
        topic: 'Califica correctamente la llamada', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'Llamada calificada'
      }
    ]
  },
  {
    blockName: 'Vcas',
    topics: [
      { 
        topic: 'Calificación de transacciones', 
        criticality: '-', 
        points: 10, 
        applies: true,
        whatToLookFor: 'Transacciones calificadas'
      },
      { 
        topic: 'Aplica Bypass', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No genera si es menos de 24hrs'
      },
      { 
        topic: 'Bloquea tarjeta', 
        criticality: 'Crítico', 
        points: 5, 
        applies: true,
        whatToLookFor: 'Desbloquea tarjeta después de confirmar'
      },
      { 
        topic: 'Califica transacciones', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica'
      },
      { 
        topic: 'Calificación de transacciones', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'Duplicado'
      },
      { 
        topic: 'Valida compras por facturar y cortes para identificar la compra para aclaración.\nValida que las compras no tengan una reversa', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica'
      }
    ]
  },
  {
    blockName: 'Vision',
    topics: [
      { 
        topic: 'Valida pantalla OFAA y CRESP (CVV2 incorrecto, Tarjeta vencida, Fecha de vencimiento incorrecta, TJ Cancelada, etc)', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica'
      },
      { 
        topic: 'Comentarios correctos en ASHI', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'Comentarios en ASHI'
      },
      { 
        topic: 'Desbloquea tarjeta BLKI, BLKT, BPT0, BNFC', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'Desbloqueo correcto'
      },
      { 
        topic: 'Bloqueo correcto', 
        criticality: 'Crítico', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica (se desbloquea)'
      }
    ]
  },
  {
    blockName: 'VRM',
    topics: [
      { 
        topic: 'Valida compras en ARTD y ARSD', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica'
      },
      { 
        topic: 'Calificación de transacciones, comentarios y aplica mantenimiento', 
        criticality: 'Crítico', 
        points: 10, 
        applies: true,
        whatToLookFor: 'Mantenimiento aplicado'
      }
    ]
  },
  {
    blockName: 'B.I',
    topics: [
      { 
        topic: 'Crea el Folio Correctamente', 
        criticality: '-', 
        points: 'n/a', 
        applies: false,
        whatToLookFor: 'No aplica para TH CONFIRMA'
      }
    ]
  },
  {
    blockName: 'Manejo de llamada',
    topics: [
      { 
        topic: 'Cumple con el script', 
        criticality: '-', 
        points: 17, 
        applies: true,
        whatToLookFor: 'Script de TH CONFIRMA'
      },
      { 
        topic: 'Educación, frases de conexión, comunicación efectiva y escucha activa', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'Comunicación efectiva'
      },
      { 
        topic: 'Control de llamada y Puntualidad', 
        criticality: '-', 
        points: 6, 
        applies: true,
        whatToLookFor: 'Control adecuado'
      },
      { 
        topic: 'Autentica correctamente', 
        criticality: '-', 
        points: 11, 
        applies: true,
        whatToLookFor: 'Autenticación al inicio'
      }
    ]
  }
];

// ============================================
// CRITERIOS DE MONITOREO (estructura vertical)
// Basado en la plantilla Monitoreo.xlsx
// ============================================
export const MONITOREO_CRITERIA: EvaluationBlock[] = [
  {
    blockName: 'Falcon',
    topics: [
      { 
        topic: 'Califica transacciones, Cierre de caso, Selecciona casillas de acción', 
        criticality: '-', 
        points: 20, 
        applies: true,
        whatToLookFor: 'En capturas FALCON: transacciones calificadas correctamente, caso cerrado adecuadamente, casillas de acción seleccionadas'
      }
    ]
  },
  {
    blockName: 'VRM',
    topics: [
      { 
        topic: 'Califica transacciones/Mantenimiento/Comentario', 
        criticality: '-', 
        points: 8, 
        applies: true,
        whatToLookFor: 'En capturas VRM: transacciones calificadas, mantenimiento aplicado y comentarios correctos'
      }
    ]
  },
  {
    blockName: 'Front',
    topics: [
      { 
        topic: 'Ingresa correctamente los datos del front: Calificación, Subcalificación de llamada, Socio, Correo del cliente, Número de caso, 4 dígitos de la tarjeta, Capturas, Comentario, Subir Excel', 
        criticality: '-', 
        points: 15, 
        applies: true,
        whatToLookFor: 'En capturas FRONT: verificar que todos los campos estén correctamente llenados (calificación, subcalificación, socio, correo, número de caso, 4 dígitos, capturas, comentario, Excel)'
      }
    ]
  },
  {
    blockName: 'Vcas',
    topics: [
      { 
        topic: 'Califica transacciones / Bloqueo', 
        criticality: '-', 
        points: 7, 
        applies: true,
        whatToLookFor: 'En capturas VCAS: transacciones calificadas correctamente y bloqueo aplicado si corresponde'
      }
    ]
  },
  {
    blockName: 'Vision+',
    topics: [
      { 
        topic: 'Comentario en ASHI', 
        criticality: '-', 
        points: 3, 
        applies: true,
        whatToLookFor: 'En capturas VISION/ASHI: comentarios claros y completos sobre la gestión realizada'
      },
      { 
        topic: 'Bloqueo correcto de la tarjeta', 
        criticality: '-', 
        points: 7, 
        applies: true,
        whatToLookFor: 'En capturas VISION: tipo de bloqueo correcto aplicado según corresponda'
      }
    ]
  },
  {
    blockName: 'BI',
    topics: [
      { 
        topic: 'Levantamiento correcto de ticket', 
        criticality: '-', 
        points: 10, 
        applies: true,
        whatToLookFor: 'En capturas BI: ticket levantado correctamente con todos los datos completos'
      }
    ]
  },
  {
    blockName: 'Manejo de llamada',
    topics: [
      { 
        topic: 'Cumple con el script de llamada', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En transcripción: sigue el script completo (saludo, validación, explicación del proceso, cierre)'
      },
      { 
        topic: 'Control de llamada, empatía y frases de conexión', 
        criticality: '-', 
        points: 10, 
        applies: true,
        whatToLookFor: 'En transcripción: mantiene control de la conversación, usa frases de empatía y conexión con el cliente'
      },
      { 
        topic: 'Cordialidad/Comunicación efectiva', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En transcripción: tono cordial, comunicación clara y efectiva durante toda la llamada'
      },
      { 
        topic: 'Escucha activa', 
        criticality: '-', 
        points: 10, 
        applies: true,
        whatToLookFor: 'En transcripción: demuestra escucha activa, responde adecuadamente a las inquietudes del cliente sin interrumpir'
      },
      { 
        topic: 'Solución al contacto', 
        criticality: '-', 
        points: 5, 
        applies: true,
        whatToLookFor: 'En transcripción: ofrece solución efectiva al motivo de contacto del cliente'
      }
    ]
  },
  {
    blockName: 'Casos críticos',
    topics: [
      { 
        topic: 'Calificación de caso (cierre de caso en falcon)', 
        criticality: 'Crítico', 
        points: 'n/a', 
        applies: true,
        whatToLookFor: 'En capturas FALCON: caso calificado y cerrado correctamente. Error crítico si no se cumple.'
      },
      { 
        topic: 'Califica tipo de llamada correctamente (calificación a nivel front)', 
        criticality: 'Crítico', 
        points: 'n/a', 
        applies: true,
        whatToLookFor: 'En capturas FRONT: tipo de llamada calificado correctamente. Error crítico si no se cumple.'
      },
      { 
        topic: 'Bloquea tarjeta en V+ correctamente', 
        criticality: 'Crítico', 
        points: 'n/a', 
        applies: true,
        whatToLookFor: 'En capturas VISION+: tarjeta bloqueada correctamente cuando corresponde. Error crítico si no se cumple.'
      }
    ]
  }
];

export function getCriteriaForCallType(callType: string): EvaluationBlock[] {
  const normalizedType = callType.toUpperCase().trim();
  
  if (normalizedType.includes('MONITOREO')) {
    return MONITOREO_CRITERIA;
  } else if (normalizedType.includes('FRAUDE')) {
    return FRAUD_CRITERIA;
  } else if (normalizedType.includes('TH CONFIRMA') || normalizedType.includes('TH_CONFIRMA')) {
    return TH_CONFIRMA_CRITERIA;
  }
  
  // Default: INBOUND usa FRAUD_CRITERIA
  return FRAUD_CRITERIA;
}