//backend/src/services/cache.service.ts

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import type { EvaluationResult } from '../types/index.js';

interface CacheEntry {
  cacheKey: string;
  timestamp: number;
  result: Omit<EvaluationResult, 'excelUrl'>;
  excelFilename: string;
  audioHash: string;
  imageHashes: string[];
  executiveId: string;
  callType: string;
}

class CacheService {
  private cacheDir: string;
  private cacheIndexPath: string;
  private cacheIndex: Map<string, CacheEntry>;

  constructor() {
    this.cacheDir = process.env.CACHE_DIR || './cache';
    this.cacheIndexPath = path.join(this.cacheDir, 'index.json');
    this.cacheIndex = new Map();

    // Crear directorio de caché si no existe
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      logger.info('Cache directory created', { cacheDir: this.cacheDir });
    }

    // Cargar índice de caché
    this.loadCacheIndex();
  }

  /**
   * Calcula el hash SHA256 de un archivo
   */
  private calculateFileHash(filePath: string): string {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const hashSum = crypto.createHash('sha256');
      hashSum.update(fileBuffer);
      return hashSum.digest('hex');
    } catch (error) {
      logger.error('Error calculating file hash', { filePath, error });
      throw error;
    }
  }

  /**
   * Genera una clave única para la combinación de archivos
   */
  generateCacheKey(audioPath: string, imagePaths: string[]): string {
    try {
      // Calcular hash del audio
      const audioHash = this.calculateFileHash(audioPath);

      // Calcular hashes de las imágenes y ordenarlos
      const imageHashes = imagePaths
        .map(imgPath => this.calculateFileHash(imgPath))
        .sort();

      // Combinar todos los hashes para crear la clave
      const combinedHash = crypto.createHash('sha256');
      combinedHash.update(audioHash);
      imageHashes.forEach(hash => combinedHash.update(hash));

      const cacheKey = combinedHash.digest('hex');

      logger.info('Cache key generated', {
        cacheKey: cacheKey.substring(0, 16) + '...',
        audioHash: audioHash.substring(0, 16) + '...',
        imageCount: imageHashes.length
      });

      return cacheKey;
    } catch (error) {
      logger.error('Error generating cache key', error);
      throw error;
    }
  }

  /**
   * Verifica si existe un resultado cacheado
   */
  async get(
    audioPath: string,
    imagePaths: string[]
  ): Promise<{ result: Omit<EvaluationResult, 'excelUrl'>; excelFilename: string } | null> {
    try {
      const cacheKey = this.generateCacheKey(audioPath, imagePaths);

      // Verificar si existe en el índice
      const entry = this.cacheIndex.get(cacheKey);

      if (!entry) {
        logger.info('Cache miss - No cached result found', { cacheKey: cacheKey.substring(0, 16) + '...' });
        return null;
      }

      // Verificar si el archivo Excel todavía existe
      const resultsDir = process.env.RESULTS_DIR || './results';
      const excelPath = path.join(resultsDir, entry.excelFilename);

      if (!fs.existsSync(excelPath)) {
        logger.warn('Cache entry exists but Excel file missing, invalidating cache', {
          cacheKey: cacheKey.substring(0, 16) + '...',
          excelFilename: entry.excelFilename
        });
        this.cacheIndex.delete(cacheKey);
        this.saveCacheIndex();
        return null;
      }

      // Calcular edad del caché
      const ageInHours = (Date.now() - entry.timestamp) / (1000 * 60 * 60);
      const maxAgeHours = parseInt(process.env.CACHE_MAX_AGE_HOURS || '168'); // 7 días por defecto

      if (ageInHours > maxAgeHours) {
        logger.warn('Cache entry expired', {
          cacheKey: cacheKey.substring(0, 16) + '...',
          ageInHours: ageInHours.toFixed(2),
          maxAgeHours
        });
        this.cacheIndex.delete(cacheKey);
        this.saveCacheIndex();
        return null;
      }

      logger.success('Cache hit! Returning cached result', {
        cacheKey: cacheKey.substring(0, 16) + '...',
        ageInHours: ageInHours.toFixed(2),
        score: entry.result.totalScore
      });

      return {
        result: entry.result,
        excelFilename: entry.excelFilename
      };
    } catch (error) {
      logger.error('Error retrieving from cache', error);
      return null;
    }
  }

  /**
   * Guarda un resultado en el caché
   */
  async set(
    audioPath: string,
    imagePaths: string[],
    result: Omit<EvaluationResult, 'excelUrl'>,
    excelFilename: string,
    executiveId: string,
    callType: string
  ): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(audioPath, imagePaths);
      const audioHash = this.calculateFileHash(audioPath);
      const imageHashes = imagePaths.map(img => this.calculateFileHash(img));

      const entry: CacheEntry = {
        cacheKey,
        timestamp: Date.now(),
        result,
        excelFilename,
        audioHash,
        imageHashes,
        executiveId,
        callType
      };

      this.cacheIndex.set(cacheKey, entry);
      this.saveCacheIndex();

      logger.success('Result cached successfully', {
        cacheKey: cacheKey.substring(0, 16) + '...',
        executiveId,
        callType,
        score: result.totalScore
      });
    } catch (error) {
      logger.error('Error saving to cache', error);
      // No lanzar error, continuar sin caché
    }
  }

  /**
   * Carga el índice de caché desde disco
   */
  private loadCacheIndex(): void {
    try {
      if (fs.existsSync(this.cacheIndexPath)) {
        const indexData = fs.readFileSync(this.cacheIndexPath, 'utf-8');
        const entries: CacheEntry[] = JSON.parse(indexData);

        this.cacheIndex = new Map(
          entries.map(entry => [entry.cacheKey, entry])
        );

        logger.info('Cache index loaded', {
          entries: this.cacheIndex.size,
          path: this.cacheIndexPath
        });
      } else {
        logger.info('No existing cache index found, starting fresh');
      }
    } catch (error) {
      logger.error('Error loading cache index, starting fresh', error);
      this.cacheIndex = new Map();
    }
  }

  /**
   * Guarda el índice de caché a disco
   */
  private saveCacheIndex(): void {
    try {
      const entries = Array.from(this.cacheIndex.values());
      fs.writeFileSync(
        this.cacheIndexPath,
        JSON.stringify(entries, null, 2),
        'utf-8'
      );

      logger.info('Cache index saved', {
        entries: entries.length,
        path: this.cacheIndexPath
      });
    } catch (error) {
      logger.error('Error saving cache index', error);
    }
  }

  /**
   * Limpia entradas de caché antiguas
   */
  async cleanup(): Promise<number> {
    try {
      const maxAgeHours = parseInt(process.env.CACHE_MAX_AGE_HOURS || '168');
      const now = Date.now();
      let removed = 0;

      for (const [key, entry] of this.cacheIndex.entries()) {
        const ageInHours = (now - entry.timestamp) / (1000 * 60 * 60);

        if (ageInHours > maxAgeHours) {
          this.cacheIndex.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        this.saveCacheIndex();
        logger.info('Cache cleanup completed', {
          removed,
          remaining: this.cacheIndex.size
        });
      }

      return removed;
    } catch (error) {
      logger.error('Error during cache cleanup', error);
      return 0;
    }
  }

  /**
   * Obtiene estadísticas del caché
   */
  getStats(): {
    totalEntries: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    const entries = Array.from(this.cacheIndex.values());

    if (entries.length === 0) {
      return {
        totalEntries: 0,
        oldestEntry: null,
        newestEntry: null
      };
    }

    const timestamps = entries.map(e => e.timestamp);
    const oldest = Math.min(...timestamps);
    const newest = Math.max(...timestamps);

    return {
      totalEntries: entries.length,
      oldestEntry: oldest,
      newestEntry: newest
    };
  }

  /**
   * Invalida toda la caché
   */
  async invalidateAll(): Promise<void> {
    this.cacheIndex.clear();
    this.saveCacheIndex();
    logger.warn('All cache invalidated');
  }
}

// Exportaciones
let instance: CacheService | null = null;

export const getCacheService = () => {
  if (!instance) {
    instance = new CacheService();
  }
  return instance;
};

export const cacheService = {
  get: async (audioPath: string, imagePaths: string[]) => {
    return getCacheService().get(audioPath, imagePaths);
  },
  set: async (
    audioPath: string,
    imagePaths: string[],
    result: any,
    excelFilename: string,
    executiveId: string,
    callType: string
  ) => {
    return getCacheService().set(audioPath, imagePaths, result, excelFilename, executiveId, callType);
  },
  cleanup: async () => {
    return getCacheService().cleanup();
  },
  getStats: () => {
    return getCacheService().getStats();
  },
  invalidateAll: async () => {
    return getCacheService().invalidateAll();
  }
};

export { CacheService };