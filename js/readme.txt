// UPDATE participants db

browserify js\app\Index.js --debug >index.js
browserify js\app\Admin.js --debug >js\nodejs\admin\admin.js
wget -O data/participants.json "http://portal.mikatiming.de/ah/rest/appapi/meetinginfo/race/9999990FEBE3BA0000000321/participations?apiKey=sast-152fed7f&pageMaxCount=9999"
wget -O data/participants.json "http://portal.mikatiming.de/ah/rest/appapi/meetinginfo/race/9999990FEBE3BA0000000322/participations?apiKey=sast-152fed7f&pageMaxCount=9999"

--------------------------------------------------
TO DEL ALL RACE DATA :
--------------------------------------------------
http://connectedlifestyle.dtrd.de/triathlon/rest/clearRace

wget "http://localhost:3000/raceStart/353816058291727"