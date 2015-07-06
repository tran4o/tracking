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
		
		/*var ww = 8.0/resolution;
		if (ww < 6.0)
			ww=6.0;*/
		var ww=10.0;

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
                geomrun=null;
		}
		
		if (geomrun && GUI.isShowRun) 
		{
			styles.push(new ol.style.Style({
                    geometry: new ol.geom.LineString(geomrun),
                    stroke: new ol.style.Stroke({
                        color: CONFIG.appearance.trackColorRun,
                        width: ww
                    })
                })
            );
            STYLES._genDirection(geomrun, ww, resolution, CONFIG.appearance.trackColorRun, styles);

            STYLES._genDistanceKm(geomrun, ww, resolution, styles);
        }
        if (geombike && GUI.isShowBike)
        {
            styles.push(new ol.style.Style({
                    geometry: new ol.geom.LineString(geombike),
                    stroke: new ol.style.Stroke({
                        color: CONFIG.appearance.trackColorBike,
                        width: ww
                    })
                })
            );
            STYLES._genDirection(geombike, ww, resolution, CONFIG.appearance.trackColorBike, styles);

            STYLES._genDistanceKm(geombike, ww, resolution, styles);
        }
        if (geomswim && GUI.isShowSwim) {
            styles.push(new ol.style.Style({
                    geometry: new ol.geom.LineString(geomswim),
                    stroke: new ol.style.Stroke({
                        color: CONFIG.appearance.trackColorSwim,
                        width: ww
                    })
                })
            );
            STYLES._genDirection(geomswim, ww, resolution, CONFIG.appearance.trackColorSwim, styles);

            STYLES._genDistanceKm(geomswim, ww, resolution, styles);
        }

        // CHECKPOINTS --------------------------
        if (geomswim)
        {
			if (GUI.isShowSwim)
				STYLES._genCheckpoint(geomswim, CONFIG.appearance.trackColorSwim, styles);
		}
		if (geombike)
		{
			if (CONFIG.appearance.isShowImageCheckpoint)
				STYLES._genCheckpointImage(geombike, CONFIG.appearance.imageCheckpointSwimBike, styles);
			else if (GUI.isShowBike)
				STYLES._genCheckpoint(geombike, CONFIG.appearance.trackColorBike, styles);
		}
		if (geomrun)
		{
			if (CONFIG.appearance.isShowImageCheckpoint)
				STYLES._genCheckpointImage(geomrun, CONFIG.appearance.imageCheckpointBikeRun, styles);
			else if (GUI.isShowBike)
				STYLES._genCheckpoint(geomrun, CONFIG.appearance.trackColorRun, styles);
		}

		// START-FINISH --------------------------
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
							src: CONFIG.appearance.imageFinish,
							scale : 0.45,
							anchor: [0.5, 0.5],
							rotateWithView: true,
							//rotation: -rotation,
							opacity : 1
						})
					}));
			}
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
		var part = feature.participant;
		var lstate = part.getLastState();
		/*var etxt="";
		if (lstate) {
			etxt=" "+parseFloat(Math.ceil(lstate.getSpeed() * 100) / 100).toFixed(2)+" m/s";// | acc "+parseFloat(Math.ceil(lstate.getAcceleration() * 100) / 100).toFixed(2)+" m/s";
		}*/
		var zIndex = Math.round(part.getElapsed()*1000000)*1000+part.seqId;
		/*if (part == GUI.getSelectedParticipant()) {
			zIndex=1e20;
		}*/
		var styles=[];
		//-----------------------------------------------------------------------------------------------------------------------
		var isDirection = (lstate && lstate.getSpeed() > 0 && !part.isSOS && !part.isDiscarded);
		var animFrame = ((new Date()).getTime()%3000)*Math.PI*2/3000.0;

        styles.push(new ol.style.Style( {
    	        	zIndex: zIndex,
    	        	image : new ol.style.Circle({
    	        		radius: 17,
    	        		fill: new ol.style.Fill({
    	        			color: part.isDiscarded || part.isSOS ? "rgba(192,0,0,"+(Math.sin(animFrame)*0.7+0.3)+")" : part.color
    	        		}),
    	        		stroke: new ol.style.Stroke({
    	        			color: part.isDiscarded || part.isSOS ? "rgba(255,0,0,"+(1.0-(Math.sin(animFrame)*0.7+0.3))+")" : "#ffffff", 
    	        			width: 3
    	        		})
    	        	}),
    				text: new ol.style.Text({
    					font: 'normal 13px Lato-Regular',
    					fill: new ol.style.Fill({
    					  color: '#FFFFFF'
    					}),
    					text : part.getInitials(),
    					offsetX : 0,
    					offsetY : 0
    				  })
    		    }));

		if (isDirection && part.getRotation() != null) 
		{
			styles.push(new ol.style.Style({
					zIndex: zIndex,
					image: new ol.style.Icon(({
					  anchor: [-0.5,0.5],
					  anchorXUnits: 'fraction',
					  anchorYUnits: 'fraction',
					  opacity: 1,
					  src : renderArrowBase64(48,48,part.color),
					  scale : 0.55,
					  rotation : -part.getRotation()
				   }))
			}));
		}
		return styles;
	},

	"cam" : function(feature, resolution) {
		var styles=[];

		var cam = feature.cam;
		var lstate = cam.getLastState();
		var isDirection = (lstate && lstate.getSpeed() > 0 && !cam.isSOS && !cam.isDiscarded);

		styles.push(new ol.style.Style({
			image: new ol.style.Icon(({
				//scale : 0.55,
				src : CONFIG.appearance.imageCam
			}))
		}));

		if (isDirection && cam.getRotation() != null) {
			styles.push(new ol.style.Style({
				image: new ol.style.Icon(({
					//scale : 0.55,
					// TODO - This way the text inside the image is rotating also
					// have to make the rotation with setting the correct anchors
					rotation : (-cam.getRotation() + (30*Math.PI / 180)),
					anchor: [-1,1],
					src : "img/camera" + (cam.seqId+1) + ".svg"
				}))
			}));
		}

		return styles;
	},

    "hotspot" : function(feature, resolution) {
        var styles=[];

        var hotspot = feature.hotspot;

        styles.push(new ol.style.Style({
            image: new ol.style.Icon(({
                //scale : 0.55,
                src : hotspot.getType().image
            }))
        }));

        return styles;
    },

	//------------------------------------------------
	// Private methods
	//------------------------------------------------

	_trackSelected : new ol.style.Style({
		stroke: new ol.style.Stroke({
			color: '#FF5050',
			width: 4.5
		})
	}),

	_genCheckpoint : function(geometry, color, styles) {
		var start = geometry[0];
		var end = geometry[1];
		var dx = end[0] - start[0];
		var dy = end[1] - start[1];
		var rotation = Math.atan2(dy, dx);

		styles.push(new ol.style.Style({
			geometry: new ol.geom.Point(start),
			image: new ol.style.Icon({
				src: renderBoxBase64(16,16,color),
				scale : 1,
				anchor: [0.92, 0.5],
				rotateWithView: true,
				rotation: -rotation,
				opacity : 0.65
			})
		}));
	},

	_genCheckpointImage : function(geometry, image, styles) {
		var start = geometry[0];
		//var end = geometry[1];
		//var dx = end[0] - start[0];
		//var dy = end[1] - start[1];
		//var rotation = Math.atan2(dy, dx);

		styles.push(new ol.style.Style({
			geometry: new ol.geom.Point(start),
			image: new ol.style.Icon({
				src: image,
				//scale : 0.65,
				anchor: [0.5, 0.5],
				rotateWithView: true,
				//rotation: -rotation,
				opacity : 1
			})
		}));
	},

	_genDirection : function(pts, ww, resolution, color, styles) {
        if (CONFIG.appearance.directionIconBetween <= 0) {
            // this means no need to show the directions
            return;
        }

        var cnt = 0;
        var icn = renderDirectionBase64(16, 16, color);
        var res = 0.0;
        for (var i = 0; i < pts.length - 1; i++) {
            var start = pts[i + 1];
            var end = pts[i];
            var dx = end[0] - start[0];
            var dy = end[1] - start[1];
            var len = Math.sqrt(dx * dx + dy * dy) / resolution;
            res += len;
            if (i == 0 || res >= CONFIG.appearance.directionIconBetween) {
                res = 0;
                var rotation = Math.atan2(dy, dx);
                styles.push(new ol.style.Style({
                    geometry: new ol.geom.Point([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]),
                    image: new ol.style.Icon({
                        src: icn,
                        scale: ww / 12.0,
                        anchor: [0.5, 0.5],
                        rotateWithView: true,
                        rotation: -rotation + Math.PI, // add 180 degrees
                        opacity: 1
                    })
                }));
                cnt++;
            }
        }
    },

    _genDistanceKm : function(pts, ww, resolution, styles) {
        // TODO Rumen - still not ready
        if (true) return;

        var cnt=0;
        var res=0.0;
        for (var i=0;i<pts.length-1;i++)
        {
            var start = pts[i+1];
            var end = pts[i];
            var dx = end[0] - start[0];
            var dy = end[1] - start[1];
            var len = Math.sqrt(dx*dx+dy*dy) / resolution;
            res+=len;
            if (i == 0 || res >= 300) {
                res = 0;
                var rotation = Math.atan2(dy, dx);
                styles.push(new ol.style.Style({
                    geometry: new ol.geom.Point([(start[0]+end[0])/2,(start[1]+end[1])/2]),
                    //image: new ol.style.Icon({
                    //    src: xxx,
                    //    scale : ww/12.0,
                    //    anchor: [0.5, 0.5],
                    //    rotateWithView: true,
                    //    rotation: -rotation + Math.PI, // add 180 degrees
                    //    opacity : 1
                    //}),
                    text: new ol.style.Text({
                        font: 'normal 13px Lato-Regular',
                        fill: new ol.style.Fill({
                            color: '#FFFFFF'
                        }),
                        text : len,
                        offsetX : 0,
                        offsetY : 0
                    })
                }));
                cnt++;
            }
        }
    }
};