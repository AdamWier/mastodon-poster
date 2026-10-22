import fs from "fs";
import { createRestAPIClient } from "masto";
import { config } from "dotenv";
import nodemailer from "nodemailer";
import Micropub from "micropub-helper";
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({debug:true, path:__dirname+"/.env"});
import generator from "megalodon";
import { default as axios } from "axios";

const client = createRestAPIClient({
  url: "https://nantes.social",
  accessToken: process.env.ACCESS_TOKEN,
});

const pleromaClient = generator('pleroma', 'https://jam.xwx.moe', process.env.PLEROMA_ACCESS_TOKEN);

const micropub = new Micropub({
  token: process.env.MICROPUB_TOKEN,
  clientId: "https://gimme-a-token.5eb.nl/",
  micropubEndpoint: process.env.MICROPUB_ENDPOINT,
});

const NETLIFY_JSON_FEED = "https://mycabinetofcuriosities.com/feed/syndicate-mastodon-json.json";

const DATA_FILE = "data.json";

const ERROR_FILE = "errors.json"

const postToMastodon = async (item, results) => {
  console.log(`Posting item #${results.length + 1} (${item.id})`)

  const attachments = await Promise.all(
    (item.attachments ?? []).map(async ({ url, _alt_text }) => {
      const file = await (await fetch(url))?.blob();
      return client.v2.media.create({ file, description: _alt_text });
    })
  );
  const mediaIds = attachments.map(({ id }) => id);
  const result = await client.v1.statuses.create({
    status: item.content_text,
    visibility: "public",
    mediaIds,
  });

  console.log(`Successfully posted item #${results.length + 1} at ${result.uri}`)
  return [...results, { ...result, netlifyUrl: item.id }];
};

const postToPleorama = async (item, results) => {
  console.log(`Posting item #${results.length + 1} (${item.id}) to Pleroma`)

  const attachments = await Promise.all(
    (item.attachments ?? []).map(async ({ url, _alt_text }) => {
      const response = await axios.get(url, {responseType: 'stream'})
      return pleromaClient.uploadMedia(response.data, {description: _alt_text });
    })
  );
  const mediaIds = attachments.map(({ data }) => data.id);

  const result = (await pleromaClient.postStatus(item.content_text, {media_ids: mediaIds})).data;
  return [...results, { ...result, netlifyUrl: item.id }];
}

const write = async (items) => {
  const results = await items.reduce(
    (promise, item) => promise.then((results) => item.content_text.includes('#lang_eo') ? postToPleorama(item, results).catch(e => {throw ({item, e})}) : postToMastodon(item, results).catch(e => {throw ({item, e})})),
    Promise.resolve([])
  );

  await results.reduce(
    (promise, { uri, netlifyUrl }) =>
      promise.then(async () => {
        micropub.update(netlifyUrl, {
          replace: {
            syndication: [uri],
          },
        });
      }).catch(e => {throw ({e, uri})}),
    Promise.resolve()
  );
}

const doIt = async () => {
  console.log('Starting sync')
  const feedItems = (await fetch(NETLIFY_JSON_FEED).then((response) => response.json())).items;

  const data = fs.existsSync(DATA_FILE)
    ? JSON.parse(fs.readFileSync(DATA_FILE))
    : {};

  const syncedPosts = data.syncedPosts ?? [];

  const errors = fs.existsSync("errors.json")
    ? JSON.parse(fs.readFileSync("errors.json"))
    : [];

  const alreadyProcessedPosts = [...syncedPosts, ...errors]

  const unsyncedItems = feedItems
    .filter(({ id }) => !alreadyProcessedPosts.includes(id))
    .map((item) => ({
      ...item,
      date_published: new Date(item.date_published),
    }))
    .sort((a, b) => a.date_published.getTime() - b.date_published.getTime());

  console.log(`Found ${unsyncedItems.length} items to sync`)

  if(unsyncedItems.length === 0) return;

  const isDryRun = process.argv.slice(2).includes('--dry-run');
  !isDryRun && await write(unsyncedItems);

  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({
      syncedPosts: syncedPosts.concat(unsyncedItems.map(({ id }) => id)),
    })
  );

  console.log('Wrote information to data.json')
};

const sendErrorEmail = async (e) => {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
  return transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER,
    subject: "CHRON ERROR",
    text: JSON.stringify(e.item) + '\n\n' + JSON.stringify(e.e, Object.getOwnPropertyNames(e.e)),
  });
};

const writeErrorFile = (item) => {
    const errors = fs.existsSync(ERROR_FILE)
      ? JSON.parse(fs.readFileSync(ERROR_FILE))
      : [];

    fs.writeFileSync(
      ERROR_FILE,
      JSON.stringify([...errors, item.id])
  );
}

const run = async () => {
  try {
    await doIt();
  } catch (e) {
    console.error(e)
    const isDryRun = process.argv.slice(2).includes('--dry-run');
    !isDryRun && await sendErrorEmail(e) && writeErrorFile(e.item);
  }
};

run();
