// Local double; real authorization and transactions are tested with PGlite.
const {createFixture}=require("./workspace-browser-fixture.cjs");
function createPriceFixture(port){
  const f=createFixture(port),original=f.server.listeners("request")[0],jobs=new Map(),changes=new Map(),priceState={lostReply:false,delay:0};
  for(let n=1;n<=205;n++)f.products.push({id:`f0000000-0000-4000-a000-${String(n).padStart(12,"0")}`,company_id:f.CA,serial:`PRICE-${n}`,name:`Price part ${n}`,price:3.5,revision:1,unit:"件",description:"Keep description",tags:[],deleted_at:null,created_at:"2026-01-01T00:00:00.000Z",image_path:null});
  f.products.push({id:"f0000000-0000-4000-a000-000000000999",company_id:f.CA,serial:"0000123",name:"Leading zero part",price:14.9,revision:1,unit:"公斤",description:"Keep",deleted_at:null,created_at:"2026-01-01T00:00:00.000Z",image_path:null});
  f.server.removeListener("request",original);
  f.server.on("request",async(req,res)=>{
    const path=new URL(req.url,f.origin).pathname;if(!["/rest/v1/rpc/preview_product_prices","/rest/v1/rpc/apply_product_prices"].includes(path))return original(req,res);
    res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Headers","*");res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");if(req.method==="OPTIONS"){res.writeHead(204);return res.end();}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());let user;try{user=JSON.parse(Buffer.from(req.headers.authorization.split(".")[1],"base64url").toString()).sub;}catch{}
    let data,status=200;try{
      const member=f.members.find(m=>m.company_id===body.target_company&&m.user_id===user&&m.active&&m.role==="admin");if(!member)throw Error("Administrator access required");
      if(path.endsWith("preview_product_prices"))data=f.products.filter(p=>p.company_id===body.target_company&&!p.deleted_at&&body.codes.map(c=>c.toLowerCase()).includes(p.serial.toLowerCase())).map(p=>({id:p.id,serial:p.serial,name:p.name,revision:p.revision,price:Number(p.price).toFixed(2),unit:p.unit||"件"}));
      else{
        const key=`${body.target_company}/${body.request_job}`;if(jobs.has(key)&&jobs.get(key)!==user)throw Error("Job owner mismatch");jobs.set(key,user);
        data=body.entries.map(e=>{const rowKey=`${key}/${e.row_number}`,hash=JSON.stringify(e);if(changes.has(rowKey)){const old=changes.get(rowKey);return old.hash===hash?{...old.result,replayed:true}:{row_number:e.row_number,status:"failed"};}
          const p=f.products.find(p=>p.company_id===body.target_company&&p.id===e.product_id&&!p.deleted_at&&p.serial.toLowerCase()===e.serial.toLowerCase());
          if(!p)return{row_number:e.row_number,status:"unavailable",message:"产品不可用，请重新预览。"};if(p.revision!==e.expected_revision||Number(p.price)!==Number(e.old_price))return{row_number:e.row_number,status:"conflict",message:"产品在预览后已修改，未覆盖；请重新预览。"};
          const result={row_number:e.row_number,status:Number(p.price)===Number(e.new_price)?"unchanged":"updated",product_id:p.id,old_price:Number(p.price).toFixed(2),new_price:e.new_price,replayed:false};if(result.status==="updated"){p.price=Number(e.new_price);p.revision++;}result.revision=p.revision;changes.set(rowKey,{hash,result});return result;
        });
        if(priceState.delay)await new Promise(resolve=>setTimeout(resolve,priceState.delay));if(priceState.lostReply){priceState.lostReply=false;throw Error("Simulated lost price reply");}
      }
    }catch(err){status=400;data={message:err.message,code:"FIXTURE"};}res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(data));
  });
  return{...f,priceState,priceChanges:changes};
}
module.exports={createPriceFixture};
