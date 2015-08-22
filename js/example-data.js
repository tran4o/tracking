var LIVE_STREAMS = [
    // should be maximum 6 livestreams as this is the max allowed in the LiveStream panel - 6 thumbs
    {id : 0, url : "http://www.metacdn.com/r/l/berhhozhx/mix/embed",  name : "LiveRank TV"},
    {id : 1, url : "http://www.metacdn.com/r/l/berhhozhx/cam1/embed",  name : "LiveRank Cam1"},
    {id : 2, url : "http://www.metacdn.com/r/l/berhhozhx/cam2/embed",  name : "LiveRank Cam2"},

    {id : 3, url : "http://livestream.com/accounts/14153542/events/4167686/player", name : "Programm Deutsch"},
    {id : 4, url : "http://livestream.com/accounts/14163713/events/4179542/player", name : "Programm Englisch"},
    {id : 5, url : "http://livestream.com/accounts/7166631/events/4179568/player",  name : "Stadionaufbau und Finishline"}
];

var MOVING_CAMS = {
    // for MovingCam the 'liveStream' is the id of any registered live-stream in CONFIG.js
    // so that they could be connected
    "353816054923703" : {"code" : "CAM0001", "name" : "MovingCamera One"/*, liveStream : 0*/},
    "353816054940715" : {"code" : "CAM0002", "deviceId" : "353816054940715", "name" : "MovingCamera Two"/*, liveStream : 1*/}
};

//var HOTSPOTS_EVENT_ROTH_CHALLENGE = [
//    // for Cam HotSpots the 'liveStream' is the id of any registered live-stream in CONFIG.js
//    // so that they could be connected
//    //{point : [11.151354,49.193451], type : CONFIG.hotspot.cam, liveStream : 2, clickable: true},
//    //{point : [11.131351,49.123441], type : CONFIG.hotspot.cam, liveStream : 2, clickable: true},
//
//    {point : [11.120872,49.298692], type : CONFIG.hotspot.uturn},
//    {point : [11.133390,49.296722], type : CONFIG.hotspot.uturn},
//    {point : [11.158594,49.229853], type : CONFIG.hotspot.uturn},
//
//    {point : [11.207819,49.185422], type : CONFIG.hotspot.water},
//    {point : [11.351932,49.050410], type : CONFIG.hotspot.water},
//    {point : [11.147325,49.130010], type : CONFIG.hotspot.water},
//    {point : [11.136763,49.210620], type : CONFIG.hotspot.water},
//    {point : [11.115220,49.242122], type : CONFIG.hotspot.water},
//    {point : [11.146140,49.240861], type : CONFIG.hotspot.water},
//    {point : [11.124955,49.281695], type : CONFIG.hotspot.water},
//    {point : [11.157815,49.228852], type : CONFIG.hotspot.water},
//
//    // TODO Rumen - for this event fix the distances as dynamically creating them from the track is not working OK
//    // for the bike
//    {point : [11.166967,49.111809], type : CONFIG.hotspot.km20},
//    {point : [11.346893,49.076442], type : CONFIG.hotspot.km40},
//    {point : [11.212091,49.131705], type : CONFIG.hotspot.km60},
//    {point : [11.219776,49.200865], type : CONFIG.hotspot.km80},
//    {point : [11.133514,49.132057], type : CONFIG.hotspot.km100},
//    {point : [11.350988,49.047316], type : CONFIG.hotspot.km120},
//    {point : [11.245575,49.139642], type : CONFIG.hotspot.km140},
//    {point : [11.221317,49.200551], type : CONFIG.hotspot.km160},
//
//    // for the run
//    {point : [11.111400,49.290611], type : CONFIG.hotspot.km10},
//    {point : [11.143007,49.255611], type : CONFIG.hotspot.km20},
//    {point : [11.150906,49.216603], type : CONFIG.hotspot.km30},
//    {point : [11.094671,49.245898], type : CONFIG.hotspot.km40},
//
//    // for these special hotspots the point are dynamically generated from the current track
//    {type : CONFIG.hotspot.camSwimBike, liveStream : 0, clickable: false},
//    {type : CONFIG.hotspot.camBikeRun, liveStream : 1, clickable: false}
//];

var HOTSPOTS_EVENT_CHALLENGE_WALCHSEE = [
    // for Cam HotSpots the 'liveStream' is the id of any registered live-stream in CONFIG.js
    // so that they could be connected
    //{point : [11.151354,49.193451], type : CONFIG.hotspot.cam, liveStream : 2, clickable: true},
    //{point : [11.131351,49.123441], type : CONFIG.hotspot.cam, liveStream : 2, clickable: true},

    {point : [12.294313,47.641841], type : CONFIG.hotspot.uturn},
    {point : [12.404012,47.668211], type : CONFIG.hotspot.uturn},

    {point : [12.333556,47.645869], type : CONFIG.hotspot.water},
    {point : [12.311980,47.647531], type : CONFIG.hotspot.water},
    {point : [12.277852,47.640281], type : CONFIG.hotspot.water},
    {point : [12.383346,47.659453], type : CONFIG.hotspot.water},

    // for these special hotspots the point are dynamically generated from the current track
    {type : CONFIG.hotspot.camSwimBike, liveStream : 0, clickable: false},
    //{type : CONFIG.hotspot.camBikeRun, liveStream : 1, clickable: false}
];

// only HOTSPOTS is used - so it should point to the last event
var HOTSPOTS = HOTSPOTS_EVENT_CHALLENGE_WALCHSEE;