 
import { useState } from 'react';
import AudioCall from './AudioCall';
 
const App = () => {
const [email , setEmail ] = useState('')
const [show , setShow ] = useState(false)
  
  return (
    <div className=' flex h-full  w-[100wh]'>
      <div>
       <input type='email' onChange={(e)=>setEmail(e.target.value)} />
      <button onClick={()=>{
        localStorage.setItem('email' , email)
        setShow(true)
      }}>Save email</button>
      { show ?  <AudioCall email={email}/> : null }
      </div>
    </div>
  );
};

export default App;
