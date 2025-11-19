const path = require('path');
const fs = require('fs');

const doIt = async () => {
    const feedContent = await fetch("https://mycabinetofcuriosities.com/feed/syndicate-mastodon-json.json").then((response) => response.json());

    const data = fs.existsSync('data.json') ? JSON.parse(fs.readFileSync('data.json')) : {}
    const lastSync = data.lastSync ?? new Date(1762321140000);

  let items = feedContent.items.map(item => ({
    ...item,
    date_published: new Date(item.date_published)
  })).filter(({date_published}) => date_published.getTime() > lastSync);

  console.log(items, lastSync)

}

doIt()