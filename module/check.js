"use strict";
const index = require("./index.js");
const sql = require("./sql.js");
const api = require("./api.js");
const nodemailer = require("nodemailer");
const https = require("https");
const promise = require("promise");
const querystring = require("querystring");
const schedule = require("node-schedule");
const path = require("path");
const fs = require("fs");

var config = require("../config/config.json");

var regex = new Array();
regex["id"] = [[[/^[^\s]+$/],["不能包含空格"]],[[/^.{5,16}$/],["长度为5-16个字符"]],[[/^[a-zA-Z][a-zA-Z0-9_]*$/],["必须以字母开头，只能输入数字、字母、下划线"]]];
regex["pwd"] = [[[/^[^\s]+$/],["不能包含空格"]],[[/^.{6,16}$/],["长度为6-16个字符"]],[[/^(?![0-9]+$)(?![a-z]+$)(?![A-Z]+$)(?!([^(0-9a-zA-Z)]|[\(\)])+$)([^(0-9a-zA-Z)]|[\(\)]|[a-z]|[A-Z]|[0-9]){2,}$/
],["必须包含数字、字母、符号中至少2种"]]];
regex["e"] = [[[/^.{6,32}$/],["长度为6-32个字符"]],[[/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z0-9]{2,6}$/],["请输入正确的邮箱格式"]]],
regex["ecode"] = [[[/^[^\s]+$/],["不能包含空格"]],[[/^.{6}$/],["长度为6个字符"]]];

var InputNameReplace = {
	"id": "username",
	"e": "email"
};

var __ecode = new Array();

exports.tableCheck = () => { // 检测数据表是否存在, 不存在则创建表 TUDO...
	sql.tableExistThenCreateTable(config.mysql.users.tablename);
	sql.tableExistThenCreateTable(config.mysql.authme.tablename);
};

exports.inputCheck = async (JSONdata, res) => { // 已用 Promise async/await 重构 2018-07-11
	let checkReturn = {
		InputName: JSONdata.InputName,
		CheckStatus: "false",
		Message: "null"
	};
	let InputName = JSONdata.InputName;
	let InputVal = JSONdata.InputVal.toLowerCase(); // 转小写判断
	let BizState = JSONdata.BizState;
	let regexMsg = this.regexCheck(JSONdata);
	if(regexMsg){ // 所有提交上来的请求都先进行正则判断，通过后再进行数据库查询
		checkReturn.Message = regexMsg;
		return checkReturn;
	} else {
		if(InputNameReplace[InputName]){ // 上面有个替换数组, 规定了哪些要经过数据库查询
			let checkstatus = await sql.queryExist(InputName.replace(InputName, InputNameReplace[InputName]), InputVal);
			if(!checkstatus){ // 已存在返回false
				checkReturn.CheckStatus = "false";
				checkReturn.Message = config.errMsg[InputName]["exist"];
			} else {
				checkReturn.CheckStatus = "true";
			}
			return checkReturn;
		} else {
			// 不用提交数据库查询的请求
			switch(JSONdata.InputName){
				case "ecode":
					if(this.ecodeQuery(BizState, InputVal)){
						checkReturn.CheckStatus = "true";
					} else {
						checkReturn.CheckStatus = "false";
						checkReturn.Message = config.errMsg["ecode"]["check"];
					}
					break;
				case "test":
					break;
			}
		}
		return checkReturn;
	}
};

exports.regexCheck = (JSONdata) => { // 正则判断 待重构 TUDO...
	if(!regex[JSONdata.InputName]){ // 非法提交
		return config.errMsg["default"];
	}
	for (let i = 0; i < regex[JSONdata.InputName].length; i++) {
		if(!regex[JSONdata.InputName][i][0][0].test(JSONdata.InputVal)){
			return regex[JSONdata.InputName][i][1][0];
			break;
		}
	}
};

exports.regCheck = async (JSONdata, ip) => { // 注册验证
	for(let i in JSONdata){ // 遍历正则
		if(regex[i]){
			for(let j in regex[i]){
				if(!regex[i][j][0][0].test(JSONdata[i])){
					return regex[i][j][1][0];
				}
			}
		}
	}
	if(!this.ecodeQuery(JSONdata.e, JSONdata.ecode)){ // 邮箱验证码
		return config.errMsg.ecode.check;
	}
	let sql_exist_status = await sql.queryUsernameAndEmail(JSONdata);
	if(!sql_exist_status){ // 数据库查询重复
		return config.errMsg.id.exist;
	}
	let sql_time_status = await sql.queryTime(ip, config.system.reg.interval);
	if(!sql_time_status){ // 判断注册间隔时间 单位：分钟
		return config.errMsg.reg.fast;
	}
	return true;
};

exports.verifyCheck = async (Aid, AppSecretKey, Ticket, Randstr, UserIP, Res, callback) => { // get提交人机验证 TUDO...
	let data = {
		"aid": Aid,
		"AppSecretKey": AppSecretKey,
		"Ticket": Ticket,
		"Randstr": Randstr,
		"UserIP": UserIP,
	};
	let opt = {
		hostname: "ssl.captcha.qq.com",
		port: 443,
		path: "/ticket/verify?" + querystring.stringify(data),

	}
	let return_data = "";
	try {
		https.get(opt, (req) => {
			req.on("data", (res) => {
				return_data += res;
			});
			req.on("end", (res) => {
				callback("", JSON.parse(return_data));
			});
		});
	} catch(err){
    	callback(err.message, "");
	}
};

exports.sendecode = async (JSONdata) => { // 发送邮箱验证码
	let ecode = this.ecodeAdd(JSONdata.e);
	let time = api.timestamp2Date(api.getTimeStamp());
	let transporter = nodemailer.createTransport({
		host: config.email.smtp.host,
		port: config.email.port,
		sercure: config.email.smtp.sercure,
        auth: {
            user: config.email.smtp.username,
            pass: config.email.smtp.password
        }
	});
	let email_html = fs.readFileSync(path.resolve(__dirname, "..") + "/static/cont/email.html").toString().replace(/{ecode}/g, ecode.ecode).replace(/{servername}/g, config.email.smtp.servername).replace(/{description}/g, config.email.smtp.description).replace(/{timeout}/g, config.email.ecode.timeout / 60).replace(/{time}/g, time);
	let email = {
        from: '"' + config.email.smtp.nick + '" <' + config.email.smtp.from + '>',
        to: JSONdata.e,
        subject: config.email.smtp.title,
        text: "",
        html: email_html
	};
	let mailer = new Promise((resolve, reject) => {
		transporter.sendMail(email, (error, info) => {
			if(error){
				reject(error);
			} else {
				resolve(info);
			}
		});
	});
	await mailer.then((onFulfilled, onRejected) => {
		if(onRejected){
			return false;
		}
	});
	return true;
};

exports.ecodeAdd = (email) => { // 添加验证码到容器
		let ecode = api.getRandomNum(100000, 999999);
		let deadline = api.getTimeStamp() + parseInt(config.email.ecode.timeout) * 1000;
		__ecode[email] = { "ecode": ecode, "deadline": deadline };
		return __ecode[email];
};

exports.ecodeQuery = (email, ecode) => { // 判断验证码合法性
	if(__ecode[email]){
		if(__ecode[email].ecode == ecode && __ecode[email].deadline > api.getTimeStamp()){
			return true;
		}
	}
	return false;
};

(function(){ // 匿名自执行函数，每分钟的0秒检测过期的验证码并从数组中剔除
	let job = schedule.scheduleJob("0 * * * * *", () => {
		let nowTime = api.getTimeStamp();
		for (let i in __ecode) {
			if(__ecode[i].deadline <= nowTime){
				delete __ecode[i];
			}
		}
	});
}());
