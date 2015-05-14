window.STYLES={

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
		
		if (track && track.bikeStartKM) {
			for (var i=0;i<track.distances.length;i++) {
				if (track.distances[i] >= track.bikeStartKM*1000)
					break;
			}
			var j;
			if (track.runStartKM) {
				for (j=i;j<track.distances.length;j++) {
					if (track.distances[j] >= track.runStartKM*1000)
						break;
				}
			} else {
				j=track.distances.length;
			}
			geomswim=coords.slice(0,i);
			geombike=coords.slice(i-1,j);
			if (j < track.distances.length)
				geomrun=coords.slice(j-1,track.distances.length);
			if (!geomswim.length)
				geomswim=null;
			if (!geombike.length)
				geombike=null;
			if (!geomrun.length)
				geomswim=null;
			
		}
		if (geomswim && GUI.isShowSwim) {
			styles.push
			(					
					new ol.style.Style({
						geometry: new ol.geom.LineString(geomswim),
						stroke: new ol.style.Stroke({
						color: '#ff4040',
						width: 4
					  })
					})
			);
		}
		if (geombike && GUI.isShowBike) 
		{
			styles.push
			(					
					new ol.style.Style({
						geometry: new ol.geom.LineString(geombike),
						stroke: new ol.style.Stroke({
						color: '#40ff40',
						width: 4
					  })
					})
			);
		}
		if (geomrun && GUI.isShowRun) 
		{
			styles.push
			(					
					new ol.style.Style({
						geometry: new ol.geom.LineString(geomrun),
						stroke: new ol.style.Stroke({
						color: '#ffff40',
						width: 4
					  })
					})
			);
		}
		
		//-------------------------------------
		if (coords && coords.length >= 2) 
		{
			var end = coords[1];
			var start = coords[0];
			var dx = end[0] - start[0];
			var dy = end[1] - start[1];
			var rotation = Math.atan2(dy, dx);
			styles.push(new ol.style.Style(
			{
			  geometry: new ol.geom.Point(start),
			  image: new ol.style.Icon({
				src: 'img/begin-end-arrow.png',
				scale : 0.45,
				anchor: [0.0, 0.5],
				rotateWithView: false,
				rotation: -rotation,
				opacity : 1,
			  })
			}));

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
					rotateWithView: false,
					//rotation: -rotation,
					opacity : 1,
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
						rotateWithView: false,
						rotation: -rotation,
						opacity : 0.5,
					  })
					}));*/

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
		var zIndex = Math.floor(feature.participant.getElapsed()*1000);
		var styles=[];
		//-----------------------------------------------------------------------------------------------------------------------
		var isDirection = (lstate && lstate.getSpeed() > 0 && !part.isSOS && !part.isDiscarded);
		if (!isDirection || part.getRotation() == null) 
		{
	        styles.push(new ol.style.Style(
	        {
	        	image : new ol.style.Circle({
	        		radius: 10,
	        		fill: new ol.style.Fill({
	        			color: part.color
	        		}),
	        		stroke: new ol.style.Stroke({
	        			color: "#ffffff",//"rgba("+colorAlphaArray(this.getColor(),0.5).join(",")+")", // "#ffffff",
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