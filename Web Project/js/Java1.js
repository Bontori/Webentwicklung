var obj;

function upDate(imagesPic){
    document.getElementById('preview').innerHTML=imagesPic.alt;
    document.getElementById('preview').style.background="url('"+imagesPic.src+"')";
	}


    function unDo(){ 
        var oldAlt = ""
        document.getElementById('preview').innerHTML=oldAlt;
        document.getElementById('preview').style.background='#FFFFFF';
        document.getElementById('preview').style.backgroundImage="url('')";
        }



        