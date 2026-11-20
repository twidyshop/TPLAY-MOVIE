import { Request } from 'express';
import cheerio from 'cheerio';
import { AxiosResponse } from 'axios';
import { IMovies, IMovieDetails } from '../types';

/**
 * Scrape movies asynchronously
 * @param {Request} ExpressRequest
 * @param {AxiosResponse} AxiosResponse
 * @returns {Promise.<IMovies[]>} array of movies objects
 */
export const scrapeMovies = async (
    req: Request,
    res: AxiosResponse
): Promise<IMovies[]> => {
    const $: cheerio.Root = cheerio.load(res.data);
    const payload: IMovies[] = [];
    const {
        protocol,
        headers: { host },
    } = req;

    $('main > div.container > section.archive')
        .find('div.grid-archive > div#grid-wrapper > div.infscroll-item')
        .each((i, el) => {
            const parent: cheerio.Cheerio = $(el).find('article.mega-item');
            const genres: string[] = [];

            $(parent)
                .find('footer')
                .find('div.grid-categories > a')
                .each((i, el2) => {
                    const x: string[] = $(el2).attr('href')?.split('/') ?? [];

                    if (x.length > 0 && x[1] === 'genre') {
                        genres.push(x[2]);
                    }
                });

            const movieId: string =
                $(parent)
                    .find('figure > a')
                    .attr('href')
                    ?.split('/')
                    .reverse()[1] ?? '';

            const obj = {} as IMovies;

            obj['_id'] = movieId;
            obj['title'] =
                $(parent).find('figure > a > picture > img').attr('alt') ?? '';
            obj['type'] = 'movie';
            obj['posterImg'] = `https:${$(parent)
                .find('figure > a > picture > img')
                .attr('src')}`;
            obj['rating'] = $(parent).find('figure').find('div.rating').text();
            obj['url'] = `${protocol}://${host}/movies/${movieId}`;
            obj['qualityResolution'] = $(parent)
                .find('figure')
                .find('div.quality')
                .text();
            obj['genres'] = genres;

            payload.push(obj);
        });


    // Fallback for LK21 markup changes: collect poster links from the listing page
    // when the legacy archive selectors no longer match.
    if (payload.length === 0) {
        const excluded = new Set([
            'latest', 'release', 'populer', 'popular', 'rating', 'series',
            'movies', 'genre', 'country', 'year', 'page', 'search',
        ]);
        $('main a[href], #content a[href], a[href]').each((i, anchor) => {
            const link = $(anchor);
            const image = link.find('img').first();
            const href = link.attr('href') || '';
            const imageTitle = image.attr('alt') || image.attr('title') || '';
            const imageSrc = image.attr('data-src') || image.attr('data-lazy-src') || image.attr('src') || '';
            if (!href || !imageTitle.trim() || !imageSrc || imageSrc.startsWith('data:')) return;
            let parsed: URL;
            try { parsed = new URL(href, 'https://source.invalid'); } catch { return; }
            const segments = parsed.pathname.split('/').filter(Boolean);
            if (segments.length !== 1 || excluded.has(segments[0].toLowerCase())) return;
            const id = segments[0];
            if (payload.some((item) => item._id === id)) return;
            const item = {} as IMovies;
            item['_id'] = id;
            item['title'] = imageTitle.trim();
            item['type'] = 'movie';
            item['posterImg'] = imageSrc.startsWith('//') ? 'https:' + imageSrc : imageSrc;
            item['rating'] = link.closest('article, .item, .movie, .poster, li, div').find('.rating').first().text().trim();
            item['url'] = `${protocol}://${host}/movies/${id}`;
            item['genres'] = [];
            item['qualityResolution'] = '';
            payload.push(item);
        });
    }

    return payload;
};

/**
 * Scrape movie details asynchronously
 * @param {Request} ExpressRequest
 * @param {AxiosResponse} AxiosResponse
 * @returns {Promise.<IMovieDetails>} movie details object
 */
export const scrapeMovieDetails = async (
    req: Request,
    res: AxiosResponse
): Promise<IMovieDetails> => {
    const { originalUrl } = req;

    const $: cheerio.Root = cheerio.load(res.data);
    const obj = {} as IMovieDetails;

    const genres: string[] = [];
    const directors: string[] = [];
    const countries: string[] = [];
    const casts: string[] = [];

    $('div.content').find('blockquote').find('strong').remove();

    obj['_id'] = originalUrl.split('/').reverse()[0];
    obj['title'] =
        $('div.content-poster').find('figure > picture > img').attr('alt') ??
        '';
    obj['type'] = 'movie';
    obj['posterImg'] = `https:${$('div.content-poster')
        .find('figure > picture > img')
        .attr('src')}`;

    $('div.content > div').each((i, el) => {
        /* eslint-disable */
        switch ($(el).find('h2').text().toLowerCase()) {
            case 'durasi':
                obj['duration'] = $(el).find('h3').text().trim();
                break;
            case 'imdb':
                obj['rating'] = $(el).find('h3:nth-child(2)').text().trim();
                break;
            case 'diterbitkan':
                obj['releaseDate'] = $(el).find('h3').text().trim();
                break;
            case 'kualitas':
                obj['quality'] = $(el).find('h3 > a').text().trim();
                break;
            case 'sutradara':
                $(el)
                    .find('h3 > a')
                    .each((i, el) => {
                        directors.push($(el).text().trim());
                    });
                break;
            case 'negara':
                $(el)
                    .find('h3 > a')
                    .each((i, el) => {
                        countries.push($(el).text());
                    });
                break;
            case 'genre':
                $(el)
                    .find('h3 > a')
                    .each((i, el) => {
                        genres.push($(el).text());
                    });
                break;
            case 'bintang film':
                $(el)
                    .find('h3')
                    .each((i, el) => {
                        casts.push($(el).find('a').text());
                    });
                break;
            default:
                break;
        }
        /* eslint-enable */
    });

    obj['synopsis'] = $('div.content').find('blockquote').text();
    obj['trailerUrl'] =
        $('div.action-player').find('a.fancybox').attr('href') ?? '';
    obj['genres'] = genres;
    obj['directors'] = directors;
    obj['countries'] = countries;
    obj['casts'] = casts;

    return obj;
};
