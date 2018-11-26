'use strict';
const config = require('dotenv').config();
if (config.error) {
    throw config.error;
}
const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');
const watson = require('watson-developer-cloud');
const translator = new watson.LanguageTranslatorV3({
    version: '2018-05-01',
    url: 'https://gateway-tok.watsonplatform.net/language-translator/api',
    iam_apikey: 'qEs_2K_SccqO-VvA-B6r26fAwaxBOVmFgwKZhY1eJT2I'
});

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let availableLangs = [];
let currentSourceLanguage = 'en';
let currentTargetLanguage = 'en';


function loadAvailableLangs() {
    return new Promise((resolve, reject) => {
        translator.listIdentifiableLanguages({}, (err, res) => {
            if (err) reject(err); 
            else resolve(res.languages);
        });
    });

}

function translateMessage(inputText, sourceLang = currentSourceLanguage, targetLang = currentTargetLanguage) {
    return new Promise((resolve, reject) => {
        translator.translate({
            text: inputText,
            source: sourceLang,
            target: targetLang
        }, (err, res) => {
            if (err) reject(err);
            else resolve(res);
        })
    });
}

function identifyLanguage(inputText) {
    return new Promise((resolve, reject) => {
        translator.identify({ text: inputText }, (err, res) => {
            if (err) reject(err);
            else resolve(res);
        });
    });
}

function postMessage(message, channel) {
    let options = {
      method: 'POST',
      uri: 'https://slack.com/api/chat.postMessage',
      form: {
        token: process.env.SLACK_OAUTH_ACCESS_TOKEN,
        channel: channel,
        text: message,
        as_user: false,
        username: 'Watson Bot'
      }
    };
    // Use Request module to POST
    request(options, (error, response, body) => {
      if (error) {
        console.log(error)
      }
    });
  }

app.post('/event', async (req, res, next) => {
    let q = req.body;

    // if (q.token !== process.env.SLACK_VERF_TOKEN) {
    //     res.sendStatus(400);
    //     console.log('untokenized request :' + JSON.stringify(q));
    //     return;
    // }
    switch (q.type) {
        case 'url_verification':
            res.send(q.challenge);
            break;
        case 'event_callback':
            if (!q.event.text) return;
            let identifyRes = await identifyLanguage(q.event.text);
            if (identifyRes.languages.length > 0) {
                let translateRes = await translateMessage(q.event.text, 
                    identifyRes.languages[0].language,
                    currentTargetLanguage).catch(err => console.error(err));
                console.log(JSON.stringify(translateRes));
                postMessage(translateRes.translations[0].translation, q.event.channel);
            } else {
                postMessage('Sorry, I couldn\t understand that sentence');
            }
        break;
        default:
            break;
    }
});

const server = app.listen(4000, async () => {
    availableLangs = await loadAvailableLangs();
    console.log(`started with ${availableLangs.length} detectable languages`);
});