import dotenv from 'dotenv';

dotenv.config();

import express, { Application, Request, Response } from 'express';
import morgan from 'morgan';
import cors from 'cors';
import path from 'path';
import routes from './routes';

const app: Application = express();

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
