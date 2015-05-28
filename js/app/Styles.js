window.STYLES=
{
	//------------------------------------------------
	// style function for track
	//------------------------------------------------
	"track" : function(feature,resolution) 
	{
		var styles=[];
		var track=feature.track;
		var coords=feature.getGeometry().getCoordinates();
		var geomswim=coords;
		var geombike;
		var geomrun;
		//-------------------------------------
		function genDirection(pts,color) 
		{
			var cnt=0;
			var icn = renderDirectionBase64(16,16,color); //renderArrowBase64(48,48,color);
			var res=0.0;
			for (var i=0;i<pts.length-1;i++) 
			{
				var start = pts[i+1];
				var end = pts[i];
				var len = Math.sqrt((start[0]-start[0])*(end[0]-start[0])+(end[1]-start[1])*(end[1]-start[1])) / resolution;
				res+=len;
				if (i == 0 || res >= CONFIG.appearance.directionIconBetween) { 
					res=0;
					var dx = end[0] - start[0];
					var dy = end[1] - start[1];
					var rotation = Math.atan2(dy, dx);
					styles.push(new ol.style.Style(
					{
					  geometry: new ol.geom.Point([(start[0]+end[0])/2,(start[1]+end[1])/2]),
					  image: new ol.style.Icon({
						src: icn,
						scale : 1,
						anchor: [0.5, 0.5],
						rotateWithView: true,
						rotation: -rotation,
						opacity : 1
					  })
					}));
					cnt++;
				}
			}
		}
		//-------------------------------------
		if (track && !isNaN(track.bikeStartKM)) 
		{
			for (var i=0;i<track.distances.length;i++) {
				if (track.distances[i] >= track.bikeStartKM*1000)
					break;
			}
			var j;
			if (!isNaN(track.runStartKM)) {
				for (j=i;j<track.distances.length;j++) {
					if (track.distances[j] >= track.runStartKM*1000)
						break;
				}
			} else {
				j=track.distances.length;
			}
			geomswim=coords.slice(0,i);
			geombike=coords.slice(i < 1 ? i : i-1,j);
			if (j < track.distances.length)
				geomrun=coords.slice(j < 1 ? j : j-1,track.distances.length);
			if (!geomswim.length)
				geomswim=null;
			if (!geombike.length)
				geombike=null;
			if (!geomrun.length)
				geomswim=null;
			
		}
		
		var ww = 8.0/resolution;
		if (ww < 2.0)
			ww=2.0;
		
		if (geomrun && GUI.isShowRun) 
		{
			styles.push
			(					
					new ol.style.Style({
						geometry: new ol.geom.LineString(geomrun),
						stroke: new ol.style.Stroke({
						color: CONFIG.appearance.trackColorRun,
						width: ww
					  })
					})
			);			
			genDirection(geomrun,CONFIG.appearance.trackColorRun);
		}
		if (geombike && GUI.isShowBike) 
		{
			styles.push
			(					
					new ol.style.Style({
						geometry: new ol.geom.LineString(geombike),
						stroke: new ol.style.Stroke({
						color: CONFIG.appearance.trackColorBike,
						width: ww
					  })
					})
			);
			genDirection(geombike,CONFIG.appearance.trackColorBike);
		}
		if (geomswim && GUI.isShowSwim) {
			styles.push
			(					
					new ol.style.Style({
						geometry: new ol.geom.LineString(geomswim),
						stroke: new ol.style.Stroke({
						color: CONFIG.appearance.trackColorSwim,
						width: ww
					  })
					})
			);
			genDirection(geomswim,CONFIG.appearance.trackColorSwim);
		}
		//-------------------------------------
		if (coords && coords.length >= 2) 
		{
			var start = coords[0];
			var end = coords[1];
			/*var dx = end[0] - start[0];
			var dy = end[1] - start[1];
			var rotation = Math.atan2(dy, dx);
			styles.push(new ol.style.Style(
			{
			  geometry: new ol.geom.Point(start),
			  image: new ol.style.Icon({
				src: 'img/begin-end-arrow.png',
				scale : 0.45,
				anchor: [0.0, 0.5],
				rotateWithView: true,
				rotation: -rotation,
				opacity : 1
			  })
			}));*/

			// loop?
			end = coords[coords.length-1];
			if (end[0] != start[0] || end[1] != start[1]) 
			{
				var start = coords[coords.length-2];
				var dx = end[0] - start[0];
				var dy = end[1] - start[1];
				var rotation = Math.atan2(dy, dx);
				styles.push(new ol.style.Style(
				{
				  geometry: new ol.geom.Point(end),
				  image: new ol.style.Icon({
					src: 'img/finish.png',
					scale : 0.65,
					anchor: [0.2, 0.8],
					rotateWithView: true,
					//rotation: -rotation,
					opacity : 1
				  })
				}));
			}
			

			/*if (0 == 1)
			styles.push(new ol.style.Style(
					{
					  geometry: new ol.geom.Point(end),
					  image: new ol.style.Icon({
						src: 'img/direction-small.png',
						scale : 0.7,
						anchor: [0.5, 0.5],
						rotateWithView: true,
						rotation: -rotation,
						opacity : 0.5
					  })
					}));*/

		}
		// CHECKPOINTS --------------------------
		if (geomrun) 
		{
			var end = geomrun[1];
			var start = geomrun[0];
			var dx = end[0] - start[0];
			var dy = end[1] - start[1];
			var rotation = Math.atan2(dy, dx);
			styles.push(new ol.style.Style({
				  geometry: new ol.geom.Point(start),
				  image: new ol.style.Icon({
					src: renderBoxBase64(16,16,CONFIG.appearance.trackColorRun),
					scale : 1,
					anchor: [0.92, 0.5],
					rotateWithView: true,
					rotation: -rotation,
					opacity : 0.65
				  })
			}));
		}
		if (geombike && GUI.isShowBike) 
		{
			var end = geombike[1];
			var start = geombike[0];
			var dx = end[0] - start[0];
			var dy = end[1] - start[1];
			var rotation = Math.atan2(dy, dx);
			styles.push(new ol.style.Style({
				  geometry: new ol.geom.Point(start),
				  image: new ol.style.Icon({
					src: renderBoxBase64(16,16,CONFIG.appearance.trackColorBike),
					scale : 1,
					anchor: [0.92, 0.5],
					rotateWithView: true,
					rotation: -rotation,
					opacity : 0.65
				  })
			}));
		}
		if (geomswim && GUI.isShowSwim) 
		{
			var end = geomswim[1];
			var start = geomswim[0];
			var dx = end[0] - start[0];
			var dy = end[1] - start[1];
			var rotation = Math.atan2(dy, dx);
			styles.push(new ol.style.Style({
				  geometry: new ol.geom.Point(start),
				  image: new ol.style.Icon({
					src: renderBoxBase64(16,16,CONFIG.appearance.trackColorSwim),
					scale : 1,
					anchor: [0.92, 0.5],
					rotateWithView: true,
					rotation: -rotation,
					opacity : 0.65
				  })
			}));
		}
		return styles;
	},
	//--------------------------------------
	"debugGPS" : function(feature,resolution) 
	{
		var coef = ((new Date()).getTime()-feature.timeCreated)/(CONFIG.timeouts.gpsLocationDebugShow*1000);
		if (coef > 1)
			coef=1;

		return [
		        new ol.style.Style({
		        image: new ol.style.Circle({
		            radius: coef*20,
		            stroke: new ol.style.Stroke({
		            	//feature.color
		                color: colorAlphaArray(feature.color,(1.0-coef)*1.0), 
		                width: 4
		            })
		          })
		})];
	},
	
	"participant" : function(feature,resolution) 
	{
		var etxt="";
		var part = feature.participant;
		var lstate = null;
		if (part.states.length) {
			lstate = part.states[part.states.length-1];
			etxt=" "+parseFloat(Math.ceil(lstate.getSpeed() * 100) / 100).toFixed(2)+" m/s";// | acc "+parseFloat(Math.ceil(lstate.getAcceleration() * 100) / 100).toFixed(2)+" m/s";
		}
		var zIndex = Math.round(part.getElapsed()*100000);
		/*if (part == GUI.getSelectedParticipant()) {
			zIndex=1e20;
		}*/
		var styles=[];
		//-----------------------------------------------------------------------------------------------------------------------
		var isDirection = (lstate && lstate.getSpeed() > 0 && !part.isSOS && !part.isDiscarded);
		var animFrame = ((new Date()).getTime()%3000)*Math.PI*2/3000.0;
			
		if (!isDirection || part.getRotation() == null) 
		{
	        styles.push(new ol.style.Style(
	        {
	        	image : new ol.style.Circle({
	        		radius: 8,
	        		fill: new ol.style.Fill({
	        			color: part.isDiscarded || part.isSOS ? "rgba(192,0,0,"+(Math.sin(animFrame)*0.7+0.3)+")" : part.color
	        		}),
	        		stroke: new ol.style.Stroke({
	        			color: part.isDiscarded || part.isSOS ? "rgba(255,0,0,"+(1.0-(Math.sin(animFrame)*0.7+0.3))+")" : "#ffffff", 
	        			width: 3
	        		})
	        	})
		    }));
		} else {
			styles.push(new ol.style.Style({
					zIndex: zIndex,
					image: new ol.style.Icon(({
					  anchor: [0.5,0.5],
					  anchorXUnits: 'fraction',
					  anchorYUnits: 'fraction',
					  opacity: 1,
					  src : renderArrowBase64(48,48,part.color), //"img/direction.png",
						/*feature.participant.isSOS ? 'img/warning-red.png' : 
						feature.participant.isDiscarded ? 'img/warning-yellow.png' : 
						feature.participant.icon,*/ 
					  scale : 0.55,
					  rotation : -part.getRotation()
					  //0.3
					  //size : [22,16]
				   })),
				   text: new ol.style.Text({
						font: 'bold 13px Arial,Lucida Grande,Tahoma,Verdana',
						fill: new ol.style.Fill({
						  color: feature.participant.color
						}),
						stroke: new ol.style.Stroke({
						  color: [255, 255, 255, 0.5],
						  width: 4
						}),
						text : feature.participant.getCode(),
						offsetX : 0,
						offsetY : 25
					  })
				   }));
		}
		//----------------------------------------------------------------------------------------------------------
		if (isDirection) 
			styles.push(new ol.style.Style({
				   zIndex: zIndex,
				   text: new ol.style.Text({
						font: 'bold 10px Arial,Lucida Grande,Tahoma,Verdana',
						fill: new ol.style.Fill({
						  color: feature.participant.color
						}),
						stroke: new ol.style.Stroke({
						  color: [255, 255, 255, 0.5],
						  width: 2
						}),
						text : etxt,
						offsetX : 0,
						offsetY : 36
					  })
				   }));
		return styles;
	},
	//------------------------------------------------
	"trackselected" : new ol.style.Style(
	{
		stroke: new ol.style.Stroke({
			color: '#FF5050',
			width: 4.5
		})
	})
};