Class("ParticipantState",
{
	has : {
		speed : {
			is : "rw",
			init : 0
		},
		elapsed : {
			is : "rw",
			init : 0
		},
	    timestamp : 
		{
	        is:   "rw",
	        init: [0,0]	//lon lat world mercator
	    },
	    gps : {
	    	is:   "rw",
	        init: [0,0]	//lon lat world mercator
	    },
		freq : {
			is : "rw",
			init : 0
		},
		isSOS : {
			is : "rw",
			init : false
		},
		acceleration : {
			is : "rw",
			init : 0
		},
		alt : {
			is : "rw",
			init : 0
		},
		overallRank : {
			is : "rw",
			init : 0
		},
		genderRank : {
			is : "rw",
			init : 0
		},
		groupRank : {
			is : "rw",
			init : 0
		}
	}
});		
//----------------------------------------		
Class("Participant", 
{
    //--------------------------------------
	// ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------
    has: 
	{
    	states : {
    		is : "rw",
    		init : []
    		
    	},
		code : {
			is : "rw",
			init : "CODE_NOT_SET"
		},
		id : {
			is : "rw",
			init : "ID_NOT_SET"
		},
		deviceId : {
			is : "rw",
			init : "DEVICE_ID_NOT_SET"
		},
		isTimedOut : {
			is : "rw",
			init : false
		},
		isDiscarded : {
			is : "rw",
			init : false
		},
		isSOS : {
			is : "rw",
			init : false
		},
		feature : {
			is : "rw",
			init : null
		},
		position : 
		{
	        is:   "rw",
	        init: [0,0]	//lon lat world mercator
	    },
		icon: 
		{
	        is:   "rw",
	        init: "img/player1.png"
	    },
	    image :	//100x100 
	    {
	        is:   "rw",
	        init: "img/profile1.png"
	    },
	    color : {
	        is:   "rw",
	        init: "#fff"
	    },
	    lastInterpolateTimestamp : {
	    	is : "rw",
	    	init : null
	    },
	    age : {
	    	is : "rw",
	    	init : "-"
	    },
	    rotation : {
	    	is : "rw",
	    	init : null 
	    }, 
	    elapsed : {
	    	is : "rw",
	    	init : 0
	    }, 
	    
    },
    //--------------------------------------
	methods: 
	{
		//----------------------------------------------------------
		// main function call > 
		//----------------------------------------------------------
		updateFeature : function() {
			var mpos = ol.proj.transform(this.getPosition(), 'EPSG:4326', 'EPSG:3857');
			if (this.feature) 
				this.feature.setGeometry(new ol.geom.Point(mpos));
		},
		interpolate : function() 
		{
			if (!this.states.length)
				return;
			if (this.isDiscarded || this.isSOS/* || !this.isOnRoad*/) 
			{
				var lstate=this.states[this.states.length-1];
				var pos = lstate.gps;
				if (pos[0] != this.getPosition()[0] || pos[1] != this.getPosition()[1]) 
				{
				    this.setPosition(pos);
				    this.setRotation(null);
					this.updateFeature();
				} else {
					if (this.isDiscarded) {
						this.updateFeature();
					}
				}
				return;
			}
			var ctime=(new Date()).getTime();
			this.setLastInterpolateTimestamp(ctime);
			// No enough data?
			if (this.states.length < 2)
				return;
			var res = this.calculateElapsedAverage(ctime);
			if (res) 
			{
				var tres=res;
				if (tres == TRACK.laps)
					tres=1.0;
				else
					tres=tres%1;
				this.setPosition(TRACK.getPositionFromElapsed(tres));
				this.setRotation(TRACK.getRotationFromElapsed(tres));
				this.updateFeature();
				this.setElapsed(res);
			} 
		},
		
		calculateElapsedAverage : function(ctime) {
			var res=null;
			ctime-=CONFIG.math.displayDelay*1000;
			for (var i=this.states.length-2;i>=0;i--) 
			{
				var j = i+1;
				var sa = this.calcAVGState(i);
				var sb = this.calcAVGState(j);
				if (ctime >= sa.timestamp && ctime <= sb.timestamp) 
				{ 
					res = sa.elapsed+(ctime-sa.timestamp) * (sb.elapsed-sa.elapsed) / (sb.timestamp-sa.timestamp);
					break;
				}
				if (sb.timestamp < ctime)
					break;
			}
			return res;
		},
		
		calcAVGState : function(pos) {
			if (!CONFIG.math.interpolateGPSAverage)
				return this.states[pos];
			var ssume=0;
			var ssumt=0;
			var cc=0;
			for (var i=pos;i>=0 && (pos-i)<CONFIG.math.interpolateGPSAverage;i--) {
				ssume+=this.states[i].elapsed;
				ssumt+=this.states[i].timestamp;
				cc++;
			}
			ssume/=cc;
			ssumt/=cc;
			return {elapsed : ssume,timestamp : ssumt};
		},

		ping : function(pos,freq,isSOS,ctime,alt,overallRank,groupRank,genderRank)
		{
			
			if (!ctime)
				ctime=(new Date()).getTime();
			var state = new ParticipantState({timestamp:ctime,gps:pos,isSOS:isSOS,freq:freq,alt:alt,overallRank:overallRank,groupRank:groupRank,genderRank:genderRank});
			if (isSOS) {
				this.setIsSOS(true); 
				this.addState(state);
				return;
			}
			//----------------------------------------------------------
			var tracklen = TRACK.getTrackLength();
			var tracklen1 = TRACK.getTrackLengthInWGS84();
			var llstate = this.states.length >= 2 ? this.states[this.states.length-2] : null;
			var lstate = this.states.length ? this.states[this.states.length-1] : null;
			//----------------------------------------------------------
			var best;
			var bestm=null;
			var lelp = lstate ? lstate.getElapsed() : 0;
			//----------------------------------------------------------
			var tg = TRACK.route;
			for (var i=0;i<tg.length-1;i++) 
			{
				var seg=[tg[i],tg[i+1]];
				var res = closestProjectionOfPointOnLine(pos[0],pos[1],seg[0][0],seg[0][1],seg[1][0],seg[1][1]);
				var distance = WGS84SPHERE.haversineDistance(res.pos,[res.pos[0]+res.min,res.pos[1]]);
				if (distance <= CONFIG.distances.stayOnRoadTolerance && (bestm == null || bestm >= res.min)) 
				{
					var nel = TRACK.getElapsedFromPoint(res.pos);
					if (nel > lelp) 
						res.min+=((nel-lelp) * tracklen1 * CONFIG.math.roadDistanceBestPointCalulcationCoef);
					if (bestm == null || res.min < bestm) {
						bestm=res.min;
						best=res.pos;
					}				
				}
			}
			//-----------------------------------------------------------
			if (bestm != null) 
			{
				var nel = TRACK.getElapsedFromPoint(best);
				if (lstate) 
				{
					if (nel < lstate.getElapsed()) 
					{
						// WRONG DIRECTION OR GPS DATA WRONG? SKIP..
						if ((lstate.getElapsed()-nel)*tracklen < CONFIG.constraints.backwardsEpsilonInMeter) 
							return;
						do  
						{
							nel+=1.0;
						} while (nel < lstate.getElapsed());
					}
					//--------------------------------------------------------------
					if (nel > TRACK.laps) {
						nel=TRACK.laps;
					}
					//--------------------------------------------------------------
					llstate = this.states.length >= CONFIG.math.speedAndAccelerationAverageDegree*2 ? this.states[this.states.length-CONFIG.math.speedAndAccelerationAverageDegree*2] : null;
					lstate = this.states.length >= CONFIG.math.speedAndAccelerationAverageDegree ? this.states[this.states.length-CONFIG.math.speedAndAccelerationAverageDegree] : null;
					if (lstate)  {
						state.setSpeed( tracklen * (nel-lstate.getElapsed()) * 1000 / (ctime-lstate.timestamp));
						if (llstate) 
							state.setAcceleration( (state.getSpeed()-lstate.getSpeed()) * 1000 / (ctime-lstate.timestamp));
					}
					//--------------------------------------------------------------
				}
				state.setElapsed(nel);
			} else {
				if (lstate)
					state.setElapsed(lstate.getElapsed());
				if (lstate.getElapsed() != TRACK.laps) {
					this.setIsDiscarded(true);
				}
			}
			//-----------------------------------------------------------
			this.addState(state);
			if (GUI.isDebug && !this.getIsDiscarded()) 
			{
				var feature = new ol.Feature();
				var geom = new ol.geom.Point(state.gps);
				geom.transform('EPSG:4326', 'EPSG:3857');
				feature.color=this.color;
				feature.setGeometry(geom);
				feature.timeCreated=ctime;
				GUI.debugLayerGPS.getSource().addFeature(feature);
			}
		},
		
		addState : function(state) {
			this.states.push(state);
			if (this.states.length > CONFIG.constraints.maxParticipantStateHistory && !this.isSOS)
				this.states.shift();
		},

		init : function(pos) 
		{
			var ctime = (new Date()).getTime();
			var state = new ParticipantState({timestamp:ctime,gps:pos,isSOS:false,freq:0,speed:0,elapsed:TRACK.getElapsedFromPoint(pos)});			
			this.setElapsed(state.elapsed);
			this.setStates([state]);
			this.setIsSOS(false);
			this.setIsDiscarded(false);
			var feature = new ol.Feature();
			var geom = new ol.geom.Point(pos);
			geom.transform('EPSG:4326', 'EPSG:3857');									
			feature.setGeometry(geom);
			feature.participant=this;
			this.setFeature(feature);
			GUI.participantsLayer.getSource().addFeature(feature);
			this.setPosition(pos);
			this.ping(pos,0,false,ctime,0,0,0,0);
		},
		
		getFreq : function() 
		{
			if (this.states.length)
				return this.states[this.states.length-1].freq;
			return 0;
		},

		getSpeed : function() 
		{
			if (this.states.length)
				return this.states[this.states.length-1].speed;
			return 0;
		},

		getGPS : function() 
		{
			if (this.states.length)
				return this.states[this.states.length-1].gps;
			return this.getPosition();
		},

		onDebugClick : function(event) {
			var hrate = 80+Math.round(Math.random()*20);
			var cpos = ol.proj.transform(event.coordinate, 'EPSG:3857','EPSG:4326');
			this.ping(cpos,hrate,false,Math.random()*500,parseInt(Math.random()*10),parseInt(Math.random()*10),parseInt(Math.random()*10));
		},
		
		getPopupHTML : function() {
			var pos = this.getPosition();
			if (this.isSOS || this.isDiscarded) {
				pos = this.getGPS();
			}
			var tlen = TRACK.getTrackLength();
			var ctime = (new Date()).getTime();
			var elapsed = this.calculateElapsedAverage(ctime);
			var tpart = TRACK.getTrackPart(elapsed);
			var targetKM;
			var partStart;
			var tpartMore;
			if (tpart == 0) {
				tparts="Swim";
				targetKM=TRACK.bikeStartKM;
				partStart=0;
				tpartMore="swim";
			} else if (tpart == 1) {
				tparts="Bike";
				targetKM=TRACK.runStartKM;
				partStart=TRACK.bikeStartKM;
				tpartMore="ride";
			} else if (tpart == 2) { 
				tparts="Run";
				targetKM=tlen/1000.0;
				partStart=TRACK.runStartKM;
				tpartMore="run";
			}
			var html="<div class='popup_code' style='color:rgba("+colorAlphaArray(this.getColor(),0.9).join(",")+")'>"+escapeHTML(this.getCode())+" (1)</div>";
			var freq = Math.round(this.getFreq());
			if (freq > 0) {
				html+="<div class" +
						"='popup_freq'>"+freq+"</div>";
			}
			var elkm = elapsed*tlen/1000.0;
			var elkms = parseFloat(Math.round(elkm * 100) / 100).toFixed(2);			

			/*var rekm = elapsed%1.0;
			rekm=(1.0-rekm)*tlen/1000.0;
			rekm = parseFloat(Math.round(rekm * 100) / 100).toFixed(2);*/			
			//-----------------------------------------------------
			var estf=null;
			var etxt1=null;
			var etxt2=null;
			var lstate = null; 
			if (this.states.length) 
			{
				lstate = this.states[this.states.length-1];
				if (lstate.getSpeed() > 0) 
				{
					var spms = Math.ceil(lstate.getSpeed() * 100) / 100;
					etxt1=parseFloat(spms).toFixed(2)+" m/s";
					var rot = -this.getRotation()*180/Math.PI; 
					if (rot < 0)
						rot+=360;
					if (rot != null) 
					{
						if (rot <= 0) 
							etxt1+=" E";
						else if (rot <= 45)
							etxt1+=" SE";
						else if (rot <= 90)
							etxt1+=" S";
						else if (rot <= 135)
							etxt1+=" SW";
						else if (rot <= 180)
							etxt1+=" W";
						else if (rot <= 225)
							etxt1+=" NW";
						else if (rot <= 270)
							etxt1+=" N";
						else 
							etxt1+=" NE";
					}
					estf=formatTime(new Date( ctime + targetKM*1000 / spms*1000 ));  
				}
				if (lstate.getAcceleration() > 0)
					etxt2=parseFloat(Math.ceil(lstate.getAcceleration() * 100) / 100).toFixed(2)+" m/s2";
			}
			//-------------------------------------------------------------------------------------------------
			var p1 = 100*TRACK.bikeStartKM/(tlen/1000.0);
			var p2 = 100*(TRACK.runStartKM-TRACK.bikeStartKM)/(tlen/1000.0);
			var p3 = 100*(tlen/1000.0 - TRACK.runStartKM)/(tlen/1000.0);
			var prettyCoord=
				"<div style='opacity:0.7;float:left;text-align:center;overflow:hidden;height:20px;width:"+p1+"%;background-color:"+CONFIG.appearance.trackColorSwim+"'>"+Math.round(TRACK.bikeStartKM)+" km</div>"+
				"<div style='opacity:0.7;float:left;text-align:center;overflow:hidden;height:20px;width:"+p2+"%;background-color:"+CONFIG.appearance.trackColorBike+"'>"+Math.round(TRACK.runStartKM-TRACK.bikeStartKM)+" km</div>"+
				"<div style='opacity:0.7;float:left;text-align:center;overflow:hidden;height:20px;width:"+p3+"%;background-color:"+CONFIG.appearance.trackColorRun+"'>"+Math.round(tlen/1000.0 - TRACK.runStartKM)+" km</div>"
				; //ol.coordinate.toStringHDMS(this.getPosition(), 2);

			var imgdiv;
			if (tpart == 0)
				imgdiv="<img class='popup_track_mode' style='left:"+elapsed*100+"%' src='img/swim.svg'/>"
			else if (tpart == 1)
				imgdiv="<img class='popup_track_mode' style='left:"+elapsed*100+"%' src='img/bike.svg'/>"
			else /*if (tpart == 2)*/
				imgdiv="<img class='popup_track_mode' style='left:"+elapsed*100+"%' src='img/run.svg'/>"
	

			var pass = Math.round((new Date()).getTime()/3500) % 3;
			html+="<table class='popup_table' style='background-image:url(\""+this.getImage()+"\")'>";
			var isDummy=!(elapsed > 0);
			html+="<tr><td class='lbl'>Elapsed</td><td class='value'>"+(isDummy ? "-" : elkms+" km")+"</td></tr>";
			html+="<tr><td class='lbl'>More to "+tpartMore+"</td><td class='value'>"+(isDummy ? "-" : parseFloat(Math.round((targetKM-elkm) * 100) / 100).toFixed(2) /* rekm */ +" km")+"</td></tr>";
			html+="<tr><td class='lbl'>Finish "+ tparts.toLowerCase() +"</td><td class='value'>"+(!estf ? "-" : estf)+"</td></tr>";					
			html+="<tr><td class='lbl'>Speed</td><td class='value'>"+(!isDummy && etxt1 ? etxt1 : "-") + "</td></tr>";
			html+="<tr><td class='lbl'>Acceler.</td><td class='value'>"+(!isDummy && etxt2 ? etxt2 : "-") +"</td></tr>";
			html+="<tr style='height:100%'><td>&nbsp;</td><td>&nbsp;</td></tr>";
			html+"</table>"
			html+="<div class='popup_shadow'>"+prettyCoord+imgdiv+"</div>";
			html+="<img class='popup_pulse' src='data:image/gif;base64,R0lGODlhEQAPAPIFAP8oKP9KSP9KSf6qp/+rqDymszymszymsyH5BAkPAAcAIf4RQ3JlYXRlZCB3aXRoIEdJTVAAIf8LTkVUU0NBUEUyLjADAQAAACwAAAAAEQAPAAADOnhKTHrNPSiqcESALamtWbUB2GeKI3OaIxmuKPfCbQlr3HLj5DN/qYkHmBMOeR0jodUzTpZF55PhTAAAIfkECQ8ABwAsAAAAABEADwAAAzR4utw+cMHhzgiYXgAou1gWcp4VniOpgGjare3JvXAcqJI9lzWKN6zb7zEbVga7yiOibDoSACH5BAUPAAcALAAAAAARAA8AAAMyeLrc/lCNueZ4I+ibAbhMpm2a94VjGpigpI5sI6peW72xM691NJi9yOEXFA4pxqSSkQAAIfkEAQ8ABwAsAAAAABEADwAAAzR4utw+cMHhzgiYXgAou1gWcp4VniOpgGjare3JvXAcqJI9lzWKN6zb7zEbVga7yiOibDoSADs='/>"
			return html;
		}
		
		
    }
});
