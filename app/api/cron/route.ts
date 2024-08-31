"use server";
import Product from "@/lib/models/products.model";
import { connectToDB } from "@/lib/mongoose";
import { generateEmailBody, sendEmail } from "@/lib/nodeMailer";
import { scrapeAmazonProduct } from "@/lib/scraper";
import {
  getAveragePrice,
  getEmailNotifType,
  getHighestPrice,
  getLowestPrice,
} from "@/lib/scraper/utils";
import { NextResponse } from "next/server"; // used to send a response to the client

const BATCH_SIZE = 10;
const PROCESSING_INTERVAL = 1000 * 60 * 60; // 1 hour
export async function GET() {
  try {
    await connectToDB();

    //get the next batch of products to process
    const products = await Product.find({
      $or: [
        { lastUpdated: { $exists: false } },
        { lastUpdated: { $exists: true } },
      ],
    })
      .sort({ lastUpdated: 1 }) // sort by lastUpdated in ascending order means oldest first
      .limit(BATCH_SIZE);

    if (!products || products.length === 0) {
      return NextResponse.json({ message: "No products found" });
    }

    const updatedProducts = [];
    for (const current of products) {
      try {
        const scrapedProduct = await scrapeAmazonProduct(current.url);
        if (!scrapedProduct) {
          continue;
        }
        let newProduct;
        if (
          scrapedProduct.currentPrice == null ||
          scrapedProduct.currentPrice == 0
        ) {
          newProduct = {
            ...scrapedProduct,
            isOutOfStock: true,
          };
        } else {
          const updatedPriceHistory = [
            ...current.priceHistory,
            {
              price: scrapedProduct.currentPrice,
            },
          ];

          newProduct = {
            ...scrapedProduct,
            currentPrice: scrapedProduct.currentPrice,
            priceHistory: updatedPriceHistory,
            lowestPrice: getLowestPrice(updatedPriceHistory),
            highestPrice: getHighestPrice(updatedPriceHistory),
            averagePrice: getAveragePrice(updatedPriceHistory),
          };
          //check if the price has changed & send email notification
          const emailNotifType = getEmailNotifType(current, newProduct);
          if (emailNotifType && current.users && current.users.length > 0) {
            const productInfo = {
              title: newProduct.title,
              url: newProduct.url,
              currentPrice: newProduct.currentPrice,
            };
            const emailBody = await generateEmailBody(
              productInfo,
              emailNotifType
            );
            const userEmails = current.users.map((user: any) => user.email);
            await sendEmail(userEmails, emailBody.subject, emailBody.body);
          }
        }
        //update the product in the database
        const updatedProduct = await Product.findOneAndUpdate(
          { url: newProduct.url },
          {
            ...newProduct,
            lastUpdated: new Date(),
            $setOnInsert: { createdAt: new Date() },
          },
          { new: true, upsert: true }
        );
        updatedProducts.push(updatedProduct);
      } catch (error) {
        console.error(`Error processing product: ${current.url}`, error);
      }
    }
    return NextResponse.json({
      message: "OK",
      data: updatedProducts,
    });
  } catch (error: any) {
    console.error(`Error in product update job: ${error}`);
    return NextResponse.json(
      {
        message: "Error",
        error: error,
      },
      { status: 500 }
    );
  }
}
