var Utils = require("./Utils.js");

var CONFIG = 
{
	times : {
		// Date syntax is YYYY, MONTH, DAY, HOUR, MINUTES, ...
              // NOTE that the number of the month is the (real-1) , e.g. Januaty is 0, December is 11
              begin : (new Date(2015, 6, 8, 18 , 15)).getTime()
		,end : (new Date(2015, 6, 17, 18, 15)).getTime()
	},
	timeouts : // in seconds
	{
		deviceTimeout : 60*5,
		animationFrame : 2, //2, //Utils.mobileAndTabletCheck() ? 0.4 : 0.1,
		gpsLocationDebugShow : 4,		// time to show gps location (debug) info
		streamDataInterval : 10 /* seconds */
	},
	distances : // in m
	{
		stayOnRoadTolerance : 500,	// 500m stay on road tolerance
		elapsedDirectionEpsilon : 500 // 500m direction tolerance, too fast movement will discard 
	},
	constraints : {
		backwardsEpsilonInMeter : 400, //220 m movement in the backward direction will not trigger next run counter increment		
		maxSpeed : 20,	//kmh
		maxParticipantStateHistory : 10000, // number of elements
		popupEnsureVisibleWidth : 200,
		popupEnsureVisibleHeight: 120
	},
	simulation : {
		pingInterval : 10, // interval in seconds to ping with gps data
		gpsInaccuracy : 10 	// error simulation in METER (look math.gpsInaccuracy, min 1/2)
	},	
	math : {
		gpsInaccuracy : 20,
		speedAndAccelerationAverageDegree : 2,	// calculation based on N states (average) (MIN 2)
		displayDelay : 100,	// display delay in SECONDS
		interpolateGPSAverage : 0, // number of recent values to calculate average gps for position (smoothing the curve.min 0 = NO,1 = 2 values (current and last))
		roadDistanceBestPointCalculationCoef : 0.2 // TODO EXPLAIN
	},
	constants : 
	{
		ageGroups :  
		[
		 {
			 from : null,
			 to : 8, 
			 code : "FirstAgeGroup"
		 }
		 ,{
			 from : 8,
			 to : 40, 
			 code : "MiddleAgeGroup"
		 }
		 ,{
			 from : 40,
			 to : null, 
			 code : "LastAgeGroup"
		 }
		]
	},

	event : {
		beginTimestamp : (new Date()).getTime(),
		duration : 60, //MINUTES
		id : 3
	},

	server : {
		prefix : "/triathlon/"
	},
	
	appearance : {
		trackColorSwim : '#5676ff',
		trackColorBike : '#da2346',
		trackColorRun :  '#079f36',

		// Note the sequence is always Swim-Bike-Run - so 2 change-points
		imageStart : "img/start.png",
		imageFinish : "img/finish.png",
		imageCam : "img/camera.svg",
		imageCheckpointSwimBike : "img/wz1.svg",
		imageCheckpointBikeRun : "img/wz2.svg",
		isShowImageCheckpoint : true,

        // the distance between the direction icons - in pixels,
        // if set non-positive value (0 or less) then don't show them at all
		//directionIconBetween : 200
		directionIconBetween : -1
	},

    hotspot : {
        cam : {image :"img/camera.svg"},  // use the same image for static cameras as for the moving ones
        water : {image : "img/water.svg"},
        uturn : {image : "img/uturn.svg"}
    }
};

for (var i in CONFIG)
	exports[i]=CONFIG[i];
