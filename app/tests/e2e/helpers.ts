import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_URL = pathToFileURL(resolve('dist/WPStudBook.html')).href;
