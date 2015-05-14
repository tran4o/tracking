Class("Simulator", 
{
    //--------------------------------------
	// ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------
    has: 
	{
    },
    //--------------------------------------
	methods: 
	{
		simulateParticipantSimple : function(part,trackInSeconds) 
		{
			var stime = (new Date()).getTime();
			var coef = TRACK.getTrackLength() / TRACK.getTrackLengthInWGS84();  
			setInterval(function(e) 
			{
				var ctime = (new Date()).getTime();
				var elapsed = ((ctime - stime)/1000.0)/trackInSeconds; 
				var pos = TRACK.getPositionFromElapsed(elapsed % 1.0);
				var ina = CONFIG.simulation.gpsInaccuracy/2.0;
				var dist1 = ina * (Math.random()*2.0-1.0) / coef;
				var dist2 =  ina * (Math.random()*2.0-1.0) / coef;
				var alt = 1000*Math.random();
				var overallRank = parseInt(20*Math.random())+1;
				var groupRank = parseInt(20*Math.random())+1;
				var genderRank = parseInt(20*Math.random())+1;
				pos[0]+=dist1;
				pos[1]+=dist2;
				part.ping(pos,80+Math.random()*10,false,ctime,alt,overallRank,groupRank,genderRank);
			},CONFIG.simulation.pingInterval*1000);
		}
    }
});