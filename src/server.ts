import dotenv from 'dotenv';

dotenv.config();

import express, { Application, Request, Response } from 'express';
import morgan from 'morgan';
import cors from 'cors';
import path from 'path';
import axios from 'axios';
import routes from './routes';

const app: Application = express();

// Use browser-like headers when fetching the configured source pages.
axios.defaults.timeout = 20000;
axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
axios.defaults.headers.common['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
axios.defaults.headers.common['Accept-Language'] = 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7';
axios.defaults.headers.common['Cache-Control'] = 'no-cache';

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(morgan('tiny'));
app.use(cors({ origin: '*' }));

// Serve the website without removing the existing scraper API endpoints.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.use(routes);

app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

// Human-friendly detail URLs; API endpoints /movies and /series remain unchanged.
app.get('/title/:type/:id', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/api', (_req: Request, res: Response) => {
    res.status(200).json({
        message: 'Unofficial LK21 (LayarKaca21) and NontonDrama APIs',
        data: {
            LK21_URL: process.env.LK21_URL,
            ND_URL: process.env.ND_URL,
        },
    });
});

export default app;
