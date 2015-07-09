// UPDATE participants db

browserify js\nodejs\Main.js --debug >index.js
wget -O data/participants.json "http://portal.mikatiming.de/ah/rest/appapi/meetinginfo/race/9999990FEBE3BA0000000321/participations?apiKey=sast-152fed7f&pageMaxCount=9999"




