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
	    position : 
		{
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
	    	ini : "-"
	    }
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
				var pos = this.states[this.states.length-1].gps;
				if (pos[0] != this.getPosition()[0] || pos[1] != this.getPosition()[1]) 
				{
				    this.setPosition(pos); 
					this.updateFeature();
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
				//console.log("T : "+ctime +" > "+res);
				this.setPosition(TRACK.getPositionFromElapsed(res % 1.0));
				this.updateFeature();
				
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
		
		ping : function(pos,freq,isSOS,ctime) 
		{
			if (!ctime)
				ctime=(new Date()).getTime();
			var state = new ParticipantState({timestamp:ctime,gps:pos,isSOS:isSOS,freq:freq});
			if (isSOS) {
				this.setIsSOS(true); 
				this.addState(state);
				return;
			}
			//----------------------------------------------------------
			var best;
			var bestm=null;
			var besto;
			var bestom=null;
			var bestomd;
			//----------------------------------------------------------
			var tg = TRACK.route;
			for (var i=0;i<tg.length-1;i++) 
			{
				var seg=[tg[i],tg[i+1]];
				var res = closestProjectionOfPointOnLine(pos[0],pos[1],seg[0][0],seg[0][1],seg[1][0],seg[1][1]);
				var distance = WGS84SPHERE.haversineDistance(res.pos,[res.pos[0]+res.min,res.pos[1]]);
				if (distance <= CONFIG.distances.stayOnRoadTolerance) 
				{
					if (bestm == null || res.min < bestm) {
						bestm=res.min;
						best=res.pos;
					}				
				}
				if (bestom == null || res.min < bestom) {
					bestom=res.min;
					besto=res.pos;
					bestomd=distance;
				}
			}
			//-----------------------------------------------------------
			var llstate = this.states.length >= 2 ? this.states[this.states.length-2] : null;
			var lstate = this.states.length ? this.states[this.states.length-1] : null;
			if (bestom != null) 
			{
				var nel = TRACK.getElapsedFromPoint(best);
				if (lstate) 
				{
					if (nel < lstate.getElapsed()) 
					{
						// WRONG DIRECTION OR GPS DATA WRONG? SKIP..
						if ((lstate.getElapsed()-nel)*TRACK.getTrackLength() < CONFIG.constraints.backwardsEpsilonInMeter) 
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
						state.setSpeed( TRACK.getTrackLength() * (nel-lstate.getElapsed()) * 1000 / (ctime-lstate.timestamp));
						if (llstate) 
							state.setAcceleration( (state.getSpeed()-lstate.getSpeed()) * 1000 / (ctime-lstate.timestamp));
					}
					//--------------------------------------------------------------
				}
				state.setElapsed(nel);
			}
			//-----------------------------------------------------------
			if (bestm == null) 
			{
				// out of track
				//this.setIsOnRoad(false);
				state.setPosition(besto);
			} else {
				//this.setIsOnRoad(true);
				state.setPosition(best);
			}			
			this.addState(state);
			if (GUI.isDebug) 
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
			this.setStates([state]);
			this.setIsSOS(false);
			this.setIsDiscarded(false);
			//this.setIsOnRoad(true);

			var feature = new ol.Feature();
			var geom = new ol.geom.Point(pos);
			geom.transform('EPSG:4326', 'EPSG:3857');									
			feature.setGeometry(geom);
			feature.participant=this;
			this.setFeature(feature);
			GUI.participantsLayer.getSource().addFeature(feature);
			this.setPosition(pos);
			this.ping(pos,0,false,ctime);
		},
		
		getElapsed : function() 
		{
			if (this.states.length)
				return this.states[this.states.length-1].elapsed;
			return 0;
		},

		getFreq : function() 
		{
			if (this.states.length)
				return this.states[this.states.length-1].freq;
			return 0;
		},
		
		getRank : function() {
			var el = this.getElapsed();
			var c=1;
			for (var i=0;i<TRACK.participants.length;i++) 
			{
				var p = TRACK.participants[i];
				if (p != this && p.getElapsed() > el) 
					c++;
			}
			return c;
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
			this.ping(cpos,hrate,false);
		},
		
		getPopupHTML : function() {
			var pos = this.getPosition();
			if (this.isSOS || this.isDiscarded) {
				pos = this.getGPS();
			}
			var prettyCoord = ol.coordinate.toStringHDMS(this.getPosition(), 2);
			var html="<div class='popup_code' style='color:rgba("+colorAlphaArray(this.getColor(),0.9).join(",")+")'>"+escapeHTML(this.getCode())+"</div>"
			var freq = Math.round(this.getFreq());
			if (freq > 0) {
				html+="<div class='popup_freq'>"+freq+"</div>";
			}
			var elkm = (this.lastInterpolateTimestamp ? this.calculateElapsedAverage(this.lastInterpolateTimestamp) : this.getElapsed())*TRACK.getTrackLength()/1000.0;
			elkm = parseFloat(Math.round(elkm * 100) / 100).toFixed(2);			
			
			var etxt1=null;
			var etxt2=null;
			var lstate = null;
			if (this.states.length) {
				lstate = this.states[this.states.length-1];
				if (lstate.getSpeed() > 0)
					etxt1=parseFloat(Math.ceil(lstate.getSpeed() * 100) / 100).toFixed(2)+" m/s";
				if (lstate.getAcceleration() > 0)
					etxt2=parseFloat(Math.ceil(lstate.getAcceleration() * 100) / 100).toFixed(2)+" m/s2";
			}
				
			var pass = Math.round((new Date()).getTime()/3500) % 3;

			html+="<table class='popup_table' style='background-image:url(\""+this.getImage()+"\")'>";
			var isDummy=!(this.getElapsed() > 0);
			if (pass == 0)
				html+="<tr><td class='label'>Ovr rank</td><td class='value'>"+(isDummy ? "-":this.getRank()+"/100")+"</td></tr>";
			else if (pass == 1)
					html+="<tr><td class='label'>Grp rank</td><td class='value'>"+(isDummy ? "-":this.getRank()+"/100")+"</td></tr>";
			else if (pass == 2)
				html+="<tr><td class='label'>Gnd rank</td><td class='value'>"+(isDummy ? "-":this.getRank()+"/100")+"</td></tr>";
			else
				html+="<tr><td class='label'>Run</td><td class='value'>"+(isDummy ? "-":(1+Math.floor(elkm%1)))+"</td></tr>";
			
			if (pass == 0)
				html+="<tr><td class='label'>Total</td><td class='value'>"+(isDummy ? "-" : elkm+" km")+"</td></tr>";
			else if (pass == 1)
				html+="<tr><td class='label'>Swim</td><td class='value'>"+(isDummy ? "-" : elkm+" km")+"</td></tr>";
			else if (pass == 2)
				html+="<tr><td class='label'>Bike</td><td class='value'>"+(isDummy ? "-" : elkm+" km")+"</td></tr>";
			else 
				html+="<tr><td class='label'>Run</td><td class='value'>"+(isDummy ? "-" : elkm+" km")+"</td></tr>";
			
			html+="<tr><td class='label'>Speed</td><td class='value'>"+(!isDummy && etxt1 ? etxt1 : "-") + "</td></tr>";
			html+="<tr><td class='label'>Acceler.</td><td class='value'>"+(!isDummy && etxt2 ? etxt2 : "-") +"</td></tr>";
			
			html+="<tr style='height:100%'><td>&nbsp;</td><td>&nbsp;</td></tr>";
			html+"</table>"
			
			html+="<div class='popup_shadow'>"+prettyCoord+"</div>";
			html+="<img class='popup_pulse' src='data:image/gif;base64,R0lGODlhEQAPAPIFAP8oKP9KSP9KSf6qp/+rqDymszymszymsyH5BAkPAAcAIf4RQ3JlYXRlZCB3aXRoIEdJTVAAIf8LTkVUU0NBUEUyLjADAQAAACwAAAAAEQAPAAADOnhKTHrNPSiqcESALamtWbUB2GeKI3OaIxmuKPfCbQlr3HLj5DN/qYkHmBMOeR0jodUzTpZF55PhTAAAIfkECQ8ABwAsAAAAABEADwAAAzR4utw+cMHhzgiYXgAou1gWcp4VniOpgGjare3JvXAcqJI9lzWKN6zb7zEbVga7yiOibDoSACH5BAUPAAcALAAAAAARAA8AAAMyeLrc/lCNueZ4I+ibAbhMpm2a94VjGpigpI5sI6peW72xM691NJi9yOEXFA4pxqSSkQAAIfkEAQ8ABwAsAAAAABEADwAAAzR4utw+cMHhzgiYXgAou1gWcp4VniOpgGjare3JvXAcqJI9lzWKN6zb7zEbVga7yiOibDoSADs='/>"
			return html;
		}
		
		
    }
});
