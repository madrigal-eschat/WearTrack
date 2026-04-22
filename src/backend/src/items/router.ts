import { Hono } from 'hono';
import { controller } from './controller.js';

export const router = new Hono();
router.route('/', controller);
