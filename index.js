"use strict";
let config = {};
const isProd = process.env.NODE_ENV === "production";
let transServiceConfig = {};
if (!isProd) {
  config = require("dotenv").config();
  if (config.error) {
    throw config.error;
  }
} else {
  const cfenv = require("cfenv");
  config = cfenv.getAppEnv();
  transServiceConfig = config.getService("Language Translator-bk");
}
const express = require("express");
const bodyParser = require("body-parser");
const request = require("request");
const watson = require("watson-developer-cloud");
const translator = new watson.LanguageTranslatorV3({
  version: "2018-05-01",
  url: isProd
    ? transServiceConfig.credentials.url
    : process.env.WATSON_TRANSLATOR_API_URL,
  iam_apikey: isProd
    ? transServiceConfig.credentials.apikey
    : process.env.WATSON_TRANSLATOR_API_KEY
});

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let availableLangs = [];
let currentSourceLanguage = "en";
let currentTargetLanguage = "en";

function loadAvailableLangs() {
  return new Promise((resolve, reject) => {
    translator.listIdentifiableLanguages({}, (err, res) => {
      if (err) reject(err);
      else resolve(res.languages);
    });
  });
}

async function translateMessage(inputText, sourceLang, targetLang) {
  return new Promise((resolve, reject) => {
    translator.translate(
      {
        text: inputText,
        source: sourceLang,
        target: targetLang
      },
      (err, res) => {
        if (err) reject(err);
        else resolve(res);
      }
    );
  });
}

async function identifyLanguage(inputText) {
  return new Promise((resolve, reject) => {
    translator.identify({ text: inputText }, (err, res) => {
      if (err) return reject(err);
      else return resolve(res);
    });
  });
}

async function replyMesssage(replyUrl, message, params) {
  return new Promise((resolve, reject) => {
    let reqBody = Object.assign({}, { text: message }, params);
    request.post(replyUrl, { json: reqBody }, (error, response, body) => {
      if (error) return reject(error);
      else return resolve(body);
    });
  });
}

async function postMessage(message, channel) {
  return new Promise((resolve, reject) => {
    let options = {
      method: "POST",
      uri: "https://slack.com/api/chat.postMessage",
      form: {
        token: process.env.SLACK_OAUTH_ACCESS_TOKEN,
        channel: channel,
        text: message,
        as_user: false,
        username: "Watson Bot"
      }
    };
    // Use Request module to POST
    request(options, (error, response, body) => {
      if (error) {
        return reject(error);
      } else {
        return resolve(body);
      }
    });
  });
}

async function autoTranslate(msgText) {
  return new Promise(async (resolve, reject) => {
    let identifyRes = await identifyLanguage(msgText);
    if (identifyRes.languages.length > 0) {
      let identifiedLanguage = identifyRes.languages.sort(
        (a, b) => b.confidence - a.confidence
      )[0].language;
      if (identifiedLanguage === "en") {
        currentTargetLanguage = "ja";
      } else {
        currentTargetLanguage = "en";
      }

      if (identifiedLanguage === currentTargetLanguage) {
        return resolve("That message seems to be already translated!");
      } else {
        translateMessage(msgText, identifiedLanguage, currentTargetLanguage)
          .then(async translateRes => {
            console.log(JSON.stringify(translateRes));
            return resolve(translateRes.translations[0].translation);
          })
          .catch(err => reject(err));
      }
    } else {
      return resolve("Sorry, I couldn't understand that sentence");
    }
  });
}

app.post("/command", async (req, res, rest) => {
  let transResult, postMsgResult;
  switch (req.body.command) {
    case "/translate":
      res.send(200, null);
      transResult = await autoTranslate(req.body.text);
      postMsgResult = await replyMesssage(
        req.body.response_url,
        `:-watson-: <@${req.body.user_id}>: '${req.body.text}' in ${availableLangs[currentTargetLanguage].name} would be`,
        {
          response_type: "in_channel",
          attachments: [{ text: transResult }]
        }
      );
      console.log(JSON.stringify(postMsgResult));
      break;
    case "/translatep":
      res.send(200, null);
      transResult = await autoTranslate(req.body.text);
      postMsgResult = await replyMesssage(
        req.body.response_url,
        `:-watson-: <@${req.body.user_id}>: '${req.body.text}' in ${availableLangs[currentTargetLanguage].name} would be`,
        {
          attachments: [{ text: transResult }]
        }
      );
      console.log(JSON.stringify(postMsgResult));
      break;
    default:
      console.error(
        `unknown command ${req.body.command} for request ${JSON.stringify(
          req.body
        )}`
      );
      break;
  }
});

app.post("/event", async (req, res, next) => {
  let q = req.body;

  // if (q.token !== process.env.SLACK_VERF_TOKEN) {
  //     res.sendStatus(400);
  //     console.log('untokenized request :' + JSON.stringify(q));
  //     return;
  // }
  switch (q.type) {
    case "url_verification":
      res.send(q.challenge);
      break;
    case "event_callback":
      if (!q.event.text) return;
      switch (q.event.type) {
        case "app_mention":
          let msgText = q.event.text
            .replace(`<@${q.authed_users[0]}>`, "")
            .trim();
          let result = await autoTranslate(msgText);
          let postResult = await postMessage(result, q.event.channel);
          console.log(JSON.stringify(postResult));
          break;

        default:
          break;
      }
      break;
    default:
      break;
  }
});

const server = app.listen(process.env.PORT, async () => {
  const alResult = await loadAvailableLangs();
  alResult.forEach(l => (availableLangs[l.language] = l));
  console.log(
    `started with ${Object.keys(availableLangs).length} detectable languages`
  );
});
