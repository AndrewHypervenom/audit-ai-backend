// backend/src/utils/progress-logger.ts

import { Response } from 'express';

export class ProgressLogger {
  private res: Response | null = null;
  private connected: boolean = false;

  constructor(res?: Response) {
    if (res) {
      this.connect(res);
    }
  }

  connect(res: Response) {
    this.res = res;
    
    // Configurar headers para SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    this.connected = true;
    this.send('connected', { message: 'Progress stream connected' });
  }

  send(type: string, data: any) {
    if (!this.connected || !this.res) return;

    const payload = {
      type,
      timestamp: new Date().toISOString(),
      ...data
    };

    try {
      this.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (error) {
      console.error('Error sending SSE:', error);
      this.connected = false;
    }
  }

  info(message: string, data?: any) {
    this.send('info', { message, ...data });
  }

  success(message: string, data?: any) {
    this.send('success', { message, ...data });
  }

  error(message: string, error?: any) {
    this.send('error', { message, error: error?.message || String(error) });
  }

  progress(stage: string, progress: number, message: string) {
    this.send('progress', { stage, progress, message });
  }

  close() {
    if (this.connected && this.res) {
      this.res.end();
      this.connected = false;
    }
  }
}