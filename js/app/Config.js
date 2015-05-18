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
		popupEnsureVisibleHeight: 120,
	},
	math : {
		speedAndAccelerationAverageDegree : 4,	// caclulation based on N states (average) (MIN 2)
		displayDelay : 30,	// display delay in SECONDS
		interpolateGPSAverage : 3, // number of recent values to caclulate average gps for position (smooting the curve.min 0 = NO,1 = 2 values (current and last))
		roadDistanceBestPointCalulcationCoef : 0.2 // TODO EXPLAIN
	},
	simulation : {
		pingInterval : 10, // interval in secods to ping with gps data
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
		prefix : "http://ts2.hmsu.org/triathlon/"
	},
	
	appearance : {
		trackColorSwim : '#FF4040',
		trackColorBike : '#00BF00',
		trackColorRun :  '#4040FF',
		directionIconBetween : 100	/* pixels */
	}
};