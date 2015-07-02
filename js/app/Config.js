window.CONFIG=
{
	timeouts : // in seconds
	{
		deviceTimeout : 60*5,
		animationFrame : MOBILE ? 0.4 : 0.1,
		gpsLocationDebugShow : 4		// time to show gps location (debug) info
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
	math : {
		gpsInaccuracy : 40,
		speedAndAccelerationAverageDegree : 4,	// calculation based on N states (average) (MIN 2)
		displayDelay : 30,	// display delay in SECONDS
		interpolateGPSAverage : 3, // number of recent values to calculate average gps for position (smoothing the curve.min 0 = NO,1 = 2 values (current and last))
        roadDistanceBestPointCalculationCoef : 0.2 // TODO EXPLAIN
	},
	simulation : {
		pingInterval : 10, // interval in seconds to ping with gps data
		gpsInaccuracy : 30 	// error simulation in METER
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
		trackColorSwim : '#00a54f',
		trackColorBike : '#ff00ff',
		trackColorRun :  '#00aeef',
        // the distance between the direction icons - in pixels,
        // if set non-positive value (0 or less) then don't show them at all
		//directionIconBetween : 200
		directionIconBetween : -1
	},

    liveStream : {
        maxStreams : 8,
        streams : ["url1", "url2", "url3"]
    }
};