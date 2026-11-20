import { getSourcePage, respondSourceError } from '../utils/source-request';
import { NextFunction as Next, Request, Response } from 'express';
import { scrapeSearchedMoviesOrSeries } from '../scrapers/search';

type TController = (req: Request, res: Response, next?: Next) => Promise<void>;

/**
 * Controller for /search/:title` route
 * @param {Request} req
 * @param {Response} res
 * @param {Next} next
 */
export const searchedMoviesOrSeries: TController = async (req, res) => {
    try {
        const { title = '' } = req.params;

        const axiosRequest = await getSourcePage(
            `${process.env.LK21_URL}/?s=${encodeURIComponent(title)}`
        );

        const payload = await scrapeSearchedMoviesOrSeries(req, axiosRequest);

        res.status(200).json(payload);
    } catch (err) {
        respondSourceError(res, err, 'LK21');
    }
};
