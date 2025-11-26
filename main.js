import fs from "fs";
import { createRestAPIClient } from "masto";
import { config } from "dotenv";
import nodemailer from "nodemailer";
config();

const doIt = async () => {
    console.log("go")

  const feedContent = await fetch(
    "https://mycabinetofcuriosities.com/feed/syndicate-mastodon-json.json"
  ).then((response) => response.json());

  const data = fs.existsSync("data.json")
    ? JSON.parse(fs.readFileSync("data.json"))
    : {};

  const syncedPosts = data.syncedPosts ?? [];

  let items = feedContent.items
    .map((item) => ({
      ...item,
      date_published: new Date(item.date_published),
    }))
    .filter(({ id }) => !syncedPosts.includes(id))
    .sort((a, b) => a.date_published.getTime() - b.date_published.getTime());

  const client = createRestAPIClient({
    url: "https://mastodon.social",
    accessToken: process.env.ACCESS_TOKEN,
  });

  await items.reduce(
    (promise, item) => promise.then(handleItem(item, client)),
    Promise.resolve()
  );

  fs.writeFileSync(
    "data.json",
    JSON.stringify({ syncedPosts: syncedPosts.concat(items.map(({id}) => id ))})
  );
};

const handleItem = async (item, client) => {
  const attachments = await Promise.all(
    (item.attachments ?? []).map(async ({ url, _alt_text }) => {
      const file = await (await fetch(url))?.blob();
      return client.v2.media.create({ file, description: _alt_text });
    })
  );
  const mediaIds = attachments.map(({ id }) => id);
  client.v1.statuses.create({
    status: item.content_text,
    visibility: "public",
    mediaIds,
  });
};

const sendErrorEmail = e => {
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
        text: JSON.stringify(e, Object.getOwnPropertyNames(e))
      });
}

let intervalId = 0;

const runChron = async () => {
            try{
                console.log("start")
                await doIt()
            } catch(e){
                sendErrorEmail(e)
                clearInterval(intervalId)
            }
}

intervalId = setInterval(runChron, 60000)