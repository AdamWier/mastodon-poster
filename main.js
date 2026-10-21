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


const client = createRestAPIClient({
  url: "https://nantes.social",
  accessToken: process.env.ACCESS_TOKEN,
});

const micropub = new Micropub({
  token: process.env.MICROPUB_TOKEN,
  clientId: "https://gimme-a-token.5eb.nl/",
  micropubEndpoint: process.env.MICROPUB_ENDPOINT,
});

const netlifyJsonFeed = "https://mycabinetofcuriosities.com/feed/syndicate-mastodon-json.json";

const write = async (items) => {
  const results = await items.reduce(
    (promise, item) => promise.then((results) => postToMastodon(item, results)),
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
      }),
    Promise.resolve()
  );
}

const doIt = async () => {
  console.log('Starting sync')
  const feedItems = (await fetch(netlifyJsonFeed).then((response) => response.json())).items;

  const data = fs.existsSync("data.json")
    ? JSON.parse(fs.readFileSync("data.json"))
    : {};

  const syncedPosts = data.syncedPosts ?? [];

  const unsyncedItems = feedItems
    .filter(({ id }) => !syncedPosts.includes(id))
    .map((item) => ({
      ...item,
      date_published: new Date(item.date_published),
    }))
    .sort((a, b) => a.date_published.getTime() - b.date_published.getTime());

  console.log(`Found ${unsyncedItems.length} items to sync`)

  const isDryRun = process.argv.slice(2).includes('--dry-run');
  !isDryRun && await write(unsyncedItems);

  fs.writeFileSync(
    "data.json",
    JSON.stringify({
      syncedPosts: syncedPosts.concat(unsyncedItems.map(({ id }) => id)),
    })
  );

  console.log('Wrote information to data.json')
};

const postToMastodon = async (item, results) => {
  console.log(`Posting item #${results.length + 1} (${item})`)

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
    text: JSON.stringify(e, Object.getOwnPropertyNames(e)),
  });
};

const run = async () => {
  try {
    await doIt();
  } catch (e) {
    console.log(e)
    const isDryRun = process.argv.slice(2).includes('--dry-run');
    !isDryRun && await sendErrorEmail(e);
  }
};

run();
