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
import { User } from "@/types";
import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET() {
  try {
    connectToDB();
    const products = await Product.find({});
    if (!products) throw new Error(`No products found`);
    const updatedProducts = await Promise.all(
      products.map(async (current) => {
        const scrapedProduct = await scrapeAmazonProduct(current.url);
        if (!scrapedProduct) return;

        const updatedPriceHistory: any = [
          ...current.priceHistory,
          {
            price: scrapedProduct.currentPrice,
          },
        ];
        const newProduct = {
          ...scrapedProduct,
          priceHistory: updatedPriceHistory,
          lowestPrice: getLowestPrice(updatedPriceHistory),
          highestPrice: getHighestPrice(updatedPriceHistory),
          averagePrice: getAveragePrice(updatedPriceHistory),
        };

        const updatedProduct = await Product.findOneAndUpdate(
          {
            url: scrapedProduct.url,
          },
          newProduct
        );
        //checking item status & mailing
        const emailNotify = getEmailNotifType(scrapedProduct, current);
        if (emailNotify && updatedProduct.user.length > 0) {
          const productInfo = {
            title: updatedProduct.title,
            url: updatedProduct.url,
          };
          const emailContent = await generateEmailBody(
            productInfo,
            emailNotify
          );
          const userEmails = updatedProduct.users.map((user: any) => {
            user.email;
          });

          await sendEmail(emailContent, userEmails);
        }
        return updatedProduct;
      })
    );
    return NextResponse.json({
      message: "OK",
      data: updatedProducts,
    });
  } catch (error: any) {
    throw new Error(`Error in get cron,${error}`);
  }
}
